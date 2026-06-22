# Painel de Campanhas — Unique Automóveis (Meta Ads)

Painel web para o dono da loja acompanhar as campanhas do Gerenciador de Anúncios
em tempo quase real: **volume de leads, investimento e gráficos de evolução**.

O token do Meta fica **só no servidor** (`.env`) — o navegador nunca vê o token,
ele só recebe dados já tratados pela API local.

## Como rodar (local)

```bash
npm install
npm start
```

Abra **http://localhost:3000**. O painel atualiza sozinho a cada 60 segundos.

## O que ele mostra

- **Investimento** no período
- **Leads (total)** = conversas de WhatsApp/Direct iniciadas + leads de formulário
- **Custo por lead (CPL)**, conexões de mensagem, impressões, alcance, cliques, CTR, CPC
- **Gráfico de gasto diário** (linha) e **leads/conversas por dia** (barras)
- **Tabela de campanhas** com status, orçamento, gasto, leads e CPL — ordenada por gasto
- Seletor de **conta** e de **período** (hoje, 7d, 14d, 30d, este mês, mês passado)

## Configuração (`.env`)

| Variável | O que é |
|---|---|
| `META_TOKEN` | Token de acesso do Meta Marketing API |
| `DEFAULT_ACCOUNT` | Conta exibida ao abrir (`act_1187119852516898` = Unique CARTÃO) |
| `GRAPH_VERSION` | Versão da Graph API (`v21.0`) |
| `PORT` | Porta do servidor (`3000`) |

## ⚠️ Segurança do token

- **Troque o token atual** (ele foi exposto no chat). Gere um novo no
  [Graph API Explorer](https://developers.facebook.com/tools/explorer/) e cole no `.env`.
- Tokens de usuário expiram. Para produção, use um **System User token** de longa
  duração (Business Settings → Usuários do sistema), que não expira.
- O `.env` está no `.gitignore` — nunca suba ele pro Git.

## Subir no ar (Render — grátis)

O repositório já vem pronto (`render.yaml`, `Procfile`). Passos:

1. Crie um repositório no GitHub e suba este código (o `.env` **não** sobe, está no `.gitignore`):
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/painel-unique.git
   git push -u origin main
   ```
2. Em [render.com](https://render.com) → **New +** → **Blueprint** → conecte o repositório.
   O Render lê o `render.yaml` sozinho.
3. Em **Environment**, defina a variável **`META_TOKEN`** com o seu token do Meta
   (as outras já vêm do `render.yaml`). O Render injeta `PORT` automaticamente.
4. **Create** → em ~2 min você recebe um link público `https://painel-unique.onrender.com`.

> Observações do plano grátis do Render: o serviço "dorme" após ~15 min sem acesso e
> demora ~50s pra acordar no primeiro acesso. Pra evitar isso, use o plano pago (US$7/mês)
> ou Railway. Recomendado: colocar um login simples antes de divulgar o link.

Também funciona em Railway/Fly.io (mesmo `Procfile` + variáveis de ambiente).

## Observações

- **Leads de concessionária**: como as campanhas são de WhatsApp/engajamento, o
  "lead" real é a *conversa iniciada* (`messaging_conversation_started_7d`), não o
  lead de formulário. O painel já soma os dois.
- **Orçamento por campanha** aparece como `—` quando o orçamento está definido no
  nível de conjunto de anúncios (ABO) em vez da campanha (CBO). Dá pra somar os
  orçamentos dos ad sets numa próxima versão, se precisar.
- Os dados do Meta têm um pequeno atraso (não são instantâneos ao segundo), então
  "tempo real" aqui significa "sincronizado com o Gerenciador a cada minuto".
