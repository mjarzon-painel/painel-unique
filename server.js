import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import crypto from "node:crypto";
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

// ================= LOGIN (usuario/senha) =================
const PANEL_USER = (process.env.PANEL_USER || "admin").trim();
const PANEL_PASS = (process.env.PANEL_PASS || "unique2026").trim();
const SESSION_SECRET = process.env.SESSION_SECRET || "troque-este-segredo";
const SESSION_DAYS = 7;
const COOKIE = "painel_auth";

app.use(express.urlencoded({ extended: false })); // ler dados do formulario de login

// Cria um cookie assinado (HMAC) valido por SESSION_DAYS dias
function signSession() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = `${PANEL_USER}.${exp}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64");
}

function validSession(raw) {
  try {
    const decoded = Buffer.from(raw, "base64").toString();
    const i = decoded.lastIndexOf(".");
    const payload = decoded.slice(0, i);
    const sig = decoded.slice(i + 1);
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    if (sig.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const exp = Number(payload.split(".")[1]);
    return Date.now() < exp;
  } catch {
    return false;
  }
}

function isAuthed(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="));
  return raw ? validSession(raw.slice(COOKIE.length + 1)) : false;
}

// Pagina de login (HTML embutido, mesmo visual do painel)
function loginPage(erro = "") {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Entrar · Painel Unique</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Montserrat',sans-serif;background:#0e1525;color:#e8eefc;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .box{background:#16213a;border:1px solid #243556;border-radius:18px;padding:34px 30px;width:100%;max-width:360px}
  .logo{font-size:22px;font-weight:800;text-align:center;margin-bottom:4px}
  .logo small{display:block;font-size:11px;font-weight:600;color:#8ea2c7;letter-spacing:1px;margin-top:4px}
  label{display:block;font-size:12px;color:#8ea2c7;font-weight:600;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.5px}
  input{width:100%;background:#0e1525;border:1px solid #243556;border-radius:10px;padding:12px 14px;color:#fff;font-size:15px;font-family:inherit;outline:none}
  input:focus{border-color:#3583FF}
  button{width:100%;margin-top:24px;background:#3583FF;color:#fff;border:0;border-radius:10px;padding:13px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer}
  button:hover{background:#1f5fd6}
  .err{background:#3a1620;border:1px solid #7a2436;color:#ffb3c1;padding:10px 12px;border-radius:10px;font-size:13px;margin-top:18px;text-align:center}
</style></head><body>
  <form class="box" method="POST" action="/login">
    <div class="logo">📊 Painel de Campanhas<small>UNIQUE AUTOMÓVEIS</small></div>
    ${erro ? `<div class="err">${erro}</div>` : ""}
    <label>Usuário</label>
    <input name="user" autocomplete="username" autofocus required/>
    <label>Senha</label>
    <input name="pass" type="password" autocomplete="current-password" required/>
    <button type="submit">Entrar</button>
  </form>
</body></html>`;
}

app.get("/login", (req, res) => {
  if (isAuthed(req)) return res.redirect("/");
  res.type("html").send(loginPage());
});

app.post("/login", (req, res) => {
  const user = (req.body?.user || "").trim();
  const pass = (req.body?.pass || "").trim();
  const okUser = user === PANEL_USER;
  const okPass = pass === PANEL_PASS;
  if (okUser && okPass) {
    const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${signSession()}; HttpOnly; Path=/; Max-Age=${SESSION_DAYS * 86400}; SameSite=Lax${secure}`
    );
    return res.redirect("/");
  }
  res.status(401).type("html").send(loginPage("Usuário ou senha incorretos."));
});

app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.redirect("/login");
});

// Diagnostico TEMPORARIO (so tamanhos, nao revela a senha) - REMOVER depois
app.get("/_diag", (req, res) => {
  res.json({
    userLenRaw: (process.env.PANEL_USER || "").length,
    userLenTrim: PANEL_USER.length,
    passLenRaw: (process.env.PANEL_PASS || "").length,
    passLenTrim: PANEL_PASS.length,
    userOk: PANEL_USER === "unique",
  });
});

// Porteiro: tudo abaixo exige login (menos /healthz, /login, /logout, ja tratados acima)
app.use((req, res, next) => {
  if (req.path === "/_diag") return next();
  if (req.path === "/healthz") return next();
  if (req.path === "/healthz") return next();
  if (isAuthed(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Não autenticado" });
  return res.redirect("/login");
});

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

// Aceita ?since=YYYY-MM-DD&until=YYYY-MM-DD (intervalo personalizado) ou ?preset=...
function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function dateExpr(req) {
  const since = req.query.since;
  const until = req.query.until;
  if (isDate(since) && isDate(until)) {
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    return { param: `time_range=${tr}`, period: { start: since, stop: until } };
  }
  return { param: `date_preset=${safePreset(req.query.preset)}`, period: null };
}

// Status que NAO entram na contagem (campanhas arquivadas/excluidas)
const STATUS_FORA = new Set(["ARCHIVED", "DELETED"]);

// =================== ENDPOINTS ===================

// Lista de contas de anuncio
// Health check (usado pelo Render pra saber quando a instancia esta pronta)
app.get("/healthz", (req, res) => res.status(200).send("ok"));

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
    const { param, period: customPeriod } = dateExpr(req);

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
      `${account}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,actions&${param}&limit=200`
    );
    let period = customPeriod;
    const orfas = [];
    for (const row of ins.data || []) {
      if (!period && row.date_start) period = { start: row.date_start, stop: row.date_stop };
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
      target.conversas = s.leads.conversas;
      target.conexoes = s.leads.conexoes;
      target.leadsForm = s.leads.leadsForm;
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

    // Exclui arquivadas/excluidas da lista E da contagem
    const list = Object.values(byId)
      .filter((c) => !STATUS_FORA.has(c.status))
      .sort((a, b) => b.spend - a.spend);

    // Totais (KPIs) calculados so com as campanhas que entram na contagem
    const t = list.reduce(
      (a, c) => {
        a.spend += c.spend || 0;
        a.impressions += c.impressions || 0;
        a.clicks += c.clicks || 0;
        a.conversas += c.conversas || 0;
        a.conexoes += c.conexoes || 0;
        a.leadsForm += c.leadsForm || 0;
        return a;
      },
      { spend: 0, impressions: 0, clicks: 0, conversas: 0, conexoes: 0, leadsForm: 0 }
    );
    const leadsTotal = t.conversas + t.leadsForm;
    const totals = {
      spend: t.spend,
      impressions: t.impressions,
      clicks: t.clicks,
      ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
      cpc: t.clicks ? t.spend / t.clicks : 0,
      cpl: leadsTotal ? t.spend / leadsTotal : 0,
      leads: { total: leadsTotal, conversas: t.conversas, conexoes: t.conexoes, leadsForm: t.leadsForm },
      period: period || { start: null, stop: null },
      excluidas: Object.values(byId).filter((c) => STATUS_FORA.has(c.status)).length,
    };

    res.json({ campaigns: list, totals });
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
