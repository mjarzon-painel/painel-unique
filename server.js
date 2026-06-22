import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// CORS liberado (permite abrir o painel por outra origem, ex: preview/iframe)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const TOKEN = process.env.META_TOKEN;
const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_VERSION || "v21.0"}`;
const PORT = process.env.PORT || 3000;
const DEFAULT_ACCOUNT = process.env.DEFAULT_ACCOUNT || "";

if (!TOKEN) {
  console.error("ERRO: defina META_TOKEN no arquivo .env");
  process.exit(1);
}

// ---- Helper para chamar a Graph API ----
async function graph(pathAndQuery) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  const url = `${GRAPH}/${pathAndQuery}${sep}access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url);
  const json = await r.json();
  if (json.error) {
    const e = new Error(json.error.message || "Erro na Graph API");
    e.meta = json.error;
    throw e;
  }
  return json;
}

// ---- Parsing das acoes (leads) ----
// Para concessionaria, o "lead" real e a conversa de WhatsApp/Direct iniciada,
// somada aos leads de formulario.
const CONVERSA = "onsite_conversion.messaging_conversation_started_7d";
const CONEXAO = "onsite_conversion.total_messaging_connection";
const LEAD_FORM = ["onsite_conversion.lead", "lead", "leadgen_grouped"];

function act(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const found = actions.find((a) => a.action_type === type);
  return found ? Number(found.value) : 0;
}

function leadsFromActions(actions) {
  const conversas = act(actions, CONVERSA);
  const conexoes = act(actions, CONEXAO);
  let leadsForm = 0;
  for (const t of LEAD_FORM) leadsForm = Math.max(leadsForm, act(actions, t));
  const total = conversas + leadsForm;
  return { conversas, conexoes, leadsForm, total };
}

function summarizeInsight(row) {
  const spend = Number(row?.spend || 0);
  const impressions = Number(row?.impressions || 0);
  const clicks = Number(row?.clicks || 0);
  const ctr = Number(row?.ctr || 0);
  const cpc = Number(row?.cpc || 0);
  const leads = leadsFromActions(row?.actions);
  return {
    spend,
    impressions,
    clicks,
    ctr,
    cpc,
    leads,
    cpl: leads.total > 0 ? spend / leads.total : 0,
  };
}

const PRESETS = new Set(["today", "yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"]);
function safePreset(p) {
  return PRESETS.has(p) ? p : "last_7d";
}

// =================== ENDPOINTS ===================

// Lista de contas de anuncio
app.get("/api/accounts", async (req, res) => {
  try {
    const data = await graph(
      "me/adaccounts?fields=id,name,account_status,currency,amount_spent,balance&limit=50"
    );
    res.json({ default: DEFAULT_ACCOUNT, accounts: data.data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message, meta: e.meta });
  }
});

// Visao geral (KPIs) da conta no periodo
app.get("/api/overview", async (req, res) => {
  try {
    const account = req.query.account || DEFAULT_ACCOUNT;
    const preset = safePreset(req.query.preset);
    const fields = "spend,impressions,clicks,ctr,cpc,reach,actions";
    const data = await graph(`${account}/insights?fields=${fields}&date_preset=${preset}`);
    const row = (data.data && data.data[0]) || {};
    const summary = summarizeInsight(row);
    summary.reach = Number(row.reach || 0);
    summary.period = { start: row.date_start || null, stop: row.date_stop || null };
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: e.message, meta: e.meta });
  }
});

// Campanhas com desempenho no periodo
app.get("/api/campaigns", async (req, res) => {
  try {
    const account = req.query.account || DEFAULT_ACCOUNT;
    const preset = safePreset(req.query.preset);

    // 1) status + orcamento das campanhas
    const camps = await graph(
      `${account}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&limit=100`
    );
    const byId = {};
    for (const c of camps.data || []) {
      byId[c.id] = {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        leads: 0,
      };
    }

    // 2) insights por campanha (uma chamada so)
    const ins = await graph(
      `${account}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&date_preset=${preset}&limit=200`
    );
    const orfas = [];
    for (const row of ins.data || []) {
      const id = row.campaign_id;
      let target = byId[id];
      if (!target) {
        target = byId[id] = { id, name: row.campaign_name, status: null, objective: "", daily_budget: null, lifetime_budget: null };
        orfas.push(id);
      }
      const s = summarizeInsight(row);
      target.spend = s.spend;
      target.impressions = s.impressions;
      target.clicks = s.clicks;
      target.leads = s.leads.total;
      target.cpl = s.cpl;
    }

    // 3) busca o status real das campanhas que vieram so nas metricas
    await Promise.all(
      orfas.map(async (id) => {
        try {
          const c = await graph(`${id}?fields=name,status,objective,daily_budget,lifetime_budget`);
          const t = byId[id];
          t.name = c.name || t.name;
          t.status = c.status || "ACTIVE";
          t.objective = c.objective || t.objective;
          t.daily_budget = c.daily_budget ? Number(c.daily_budget) / 100 : t.daily_budget;
          t.lifetime_budget = c.lifetime_budget ? Number(c.lifetime_budget) / 100 : t.lifetime_budget;
        } catch {
          byId[id].status = "ACTIVE"; // se nao conseguir buscar, assume ativa (teve gasto)
        }
      })
    );

    const list = Object.values(byId).sort((a, b) => b.spend - a.spend);
    res.json({ campaigns: list });
  } catch (e) {
    res.status(500).json({ error: e.message, meta: e.meta });
  }
});

// Serie diaria (para os graficos)
app.get("/api/timeseries", async (req, res) => {
  try {
    const account = req.query.account || DEFAULT_ACCOUNT;
    const preset = safePreset(req.query.preset);
    const data = await graph(
      `${account}/insights?fields=spend,actions&time_increment=1&date_preset=${preset}&limit=200`
    );
    const series = (data.data || []).map((row) => {
      const leads = leadsFromActions(row.actions);
      return {
        date: row.date_start,
        spend: Number(row.spend || 0),
        leads: leads.total,
        conversas: leads.conversas,
      };
    });
    res.json({ series });
  } catch (e) {
    res.status(500).json({ error: e.message, meta: e.meta });
  }
});

// Arquivos estaticos do painel
app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`\n  Painel Unique rodando em: http://localhost:${PORT}\n`);
});
