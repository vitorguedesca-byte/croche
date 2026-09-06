# -*- coding: utf-8 -*-
import os
import subprocess
import sys
import shutil

html_content = """<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório Executivo — Automações e Prazos do WhatsApp</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');

  @page {
    size: A4;
    margin: 8mm 12mm 8mm 12mm;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  body {
    font-family: 'Nunito Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #2D251E;
    background: #FFFFFF;
    font-size: 8.4pt;
    line-height: 1.34;
  }

  .page {
    width: 100%;
    min-height: 280mm;
    max-height: 280mm;
    position: relative;
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }

  .page:last-child {
    page-break-after: avoid;
  }

  /* Header */
  .header {
    border-bottom: 2px solid #1F6B3A;
    padding-bottom: 5px;
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }

  .brand-title {
    font-family: 'Fraunces', serif;
    font-size: 15.5pt;
    font-weight: 700;
    color: #1F6B3A;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .brand-subtitle {
    font-size: 8.2pt;
    color: #7A6D5F;
    font-weight: 600;
    margin-top: 1px;
  }

  .badge-header {
    background: #EAF4EE;
    color: #1F6B3A;
    font-size: 7.2pt;
    font-weight: 800;
    padding: 4px 9px;
    border-radius: 6px;
    border: 1px solid #C4E2CE;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: right;
  }

  /* Footer */
  .footer {
    border-top: 1px solid #E6DDD0;
    padding-top: 4px;
    margin-top: 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.2pt;
    color: #8C7F70;
  }

  .footer-brand {
    font-weight: 700;
    color: #1F6B3A;
  }

  /* Grid layouts */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 7px;
  }

  .grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 7px;
    margin-bottom: 7px;
  }

  /* Cards */
  .card {
    background: #FAFAF7;
    border: 1px solid #E6DDD0;
    border-radius: 7px;
    padding: 7px 9px;
  }

  .card-highlight {
    background: #FDFBF7;
    border: 1.2px solid #D68A68;
    border-left: 4px solid #C2714F;
  }

  .card-green {
    background: #F8FBF9;
    border: 1.2px solid #C4E2CE;
    border-left: 4px solid #1F6B3A;
  }

  .card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
    gap: 6px;
  }

  .card-title {
    font-family: 'Fraunces', serif;
    font-size: 9.5pt;
    font-weight: 700;
    color: #1F6B3A;
    display: flex;
    align-items: center;
    gap: 4px;
    line-height: 1.2;
  }

  .card-title.terra {
    color: #B55732;
  }

  .badge-tag {
    display: inline-block;
    font-size: 6.6pt;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tag-green { background: #E3F2E7; color: #16562D; }
  .tag-terra { background: #FDEEE7; color: #9C3D19; }
  .tag-amber { background: #FFF6DE; color: #8F6200; }
  .tag-blue { background: #E7F0F8; color: #215987; }

  /* Message quote box */
  .msg-box {
    background: #FFFFFF;
    border: 1px dashed #C8BEB2;
    border-radius: 5px;
    padding: 5px 7px;
    margin-top: 5px;
    font-size: 7.5pt;
    color: #42382E;
    line-height: 1.28;
    font-style: italic;
  }

  .msg-box b {
    font-style: normal;
    color: #1F6B3A;
  }

  .msg-box .quote-tag {
    font-size: 6.3pt;
    font-weight: 800;
    font-style: normal;
    text-transform: uppercase;
    color: #8C7F70;
    display: block;
    margin-bottom: 1px;
  }

  /* Table styling */
  table.data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7.4pt;
    margin-top: 3px;
    margin-bottom: 4px;
  }

  table.data-table th {
    background: #EAE3D5;
    color: #2D251E;
    font-weight: 800;
    text-align: left;
    padding: 4px 6px;
    border: 1px solid #D5CBBF;
    font-size: 7pt;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  table.data-table td {
    padding: 3.8px 6px;
    border: 1px solid #E6DDD0;
    vertical-align: middle;
  }

  table.data-table tr:nth-child(even) {
    background: #FDFBF8;
  }

  /* Summary callout bar */
  .summary-banner {
    background: #FAF6EF;
    border: 1px solid #DFCDB9;
    border-radius: 6px;
    padding: 6px 10px;
    margin-bottom: 7px;
  }

  .summary-banner p {
    font-size: 8pt;
    color: #4A3E33;
    line-height: 1.32;
  }

  /* Section Title */
  .section-title {
    font-family: 'Fraunces', serif;
    font-size: 10.2pt;
    font-weight: 700;
    color: #1F6B3A;
    border-bottom: 1.5px solid #E2D7C7;
    padding-bottom: 2px;
    margin-top: 1px;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .section-title span.sec-num {
    background: #1F6B3A;
    color: #FFFFFF;
    font-size: 7.2pt;
    font-family: 'Nunito Sans', sans-serif;
    font-weight: 800;
    padding: 1px 5px;
    border-radius: 4px;
  }

  ul.clean-list {
    list-style: none;
    padding-left: 0;
  }

  ul.clean-list li {
    position: relative;
    padding-left: 11px;
    margin-bottom: 2px;
    font-size: 7.9pt;
  }

  ul.clean-list li::before {
    content: "•";
    position: absolute;
    left: 2px;
    color: #C2714F;
    font-weight: bold;
  }

  .kpi-row {
    display: flex;
    gap: 6px;
    margin-bottom: 7px;
  }

  .kpi-box {
    flex: 1;
    background: #FFFFFF;
    border: 1px solid #D5CBBF;
    border-radius: 6px;
    padding: 4px 6px;
    text-align: center;
  }

  .kpi-val {
    font-family: 'Fraunces', serif;
    font-size: 12pt;
    font-weight: 700;
    color: #1F6B3A;
    line-height: 1.1;
  }

  .kpi-val.terra { color: #C2714F; }
  .kpi-val.blue { color: #256699; }

  .kpi-lbl {
    font-size: 6.6pt;
    font-weight: 700;
    color: #7A6D5F;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-top: 1px;
  }
</style>
</head>
<body>

<!-- ==================== PÁGINA 1 ==================== -->
<div class="page">
  <div>
    <!-- Top Header -->
    <div class="header">
      <div>
        <div class="brand-title">🧶 Fios que Curam</div>
        <div class="brand-subtitle">Ateliê & Escola de Crochê · Inêz Pimentel | Relatório Executivo do Sistema</div>
      </div>
      <div class="badge-header">
        Automações do WhatsApp<br>
        <span style="font-weight:400; font-size:6.6pt; color:#427050;">Setembro / 2026 · Versão Produção</span>
      </div>
    </div>

    <!-- Banner Resumo Executivo -->
    <div class="summary-banner">
      <p>
        <strong>Objetivo deste Relatório:</strong> Apresentar com total clareza e transparência <strong>todas as mensagens enviadas de forma automática pelo WhatsApp oficial</strong> para as alunas e interessadas, detalhando os <strong>gatilhos operacionais</strong>, <strong>prazos exatos de tolerância</strong>, proteções anti-bloqueio (Meta) e os textos padronizados que regem o atendimento e as regras da escola.
      </p>
    </div>

    <!-- Indicadores Chave de Prazos -->
    <div class="kpi-row">
      <div class="kpi-box">
        <div class="kpi-val terra">10 min</div>
        <div class="kpi-lbl">Reserva Segurada (Pix)</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-val">3 min</div>
        <div class="kpi-lbl">Aviso de Fim de Vaga</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-val blue">30 min</div>
        <div class="kpi-lbl">Conversa Parada</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-val">D-3 / D+2</div>
        <div class="kpi-lbl">Mensalidade (A vencer / Atraso)</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-val terra">6 horas</div>
        <div class="kpi-lbl">Aviso Prévio p/ Reposição</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-val">08h às 20h</div>
        <div class="kpi-lbl">Janela de Silêncio</div>
      </div>
    </div>

    <!-- SEÇÃO 1: FLUXO DE MATRÍCULA E RESERVA SEGURADA -->
    <div class="section-title">
      <span class="sec-num">1</span> Agendamento e Reserva Segurada de Vaga (Novas Alunas e Leads)
    </div>

    <div class="grid-2">
      <!-- Card 1: Cobrança e Reserva -->
      <div class="card card-green">
        <div class="card-header-row">
          <div class="card-title">💳 1. Envio do Pix e Vaga Segurada</div>
          <span class="badge-tag tag-green">Prazo: 10 min</span>
        </div>
        <ul class="clean-list">
          <li><strong>Gatilho:</strong> Aluna escolhe turma e modalidade (Avulsa R$ 40, Mensal 1x R$ 120 ou 2x R$ 200).</li>
          <li><strong>Varredura:</strong> O robô monitora a fila de minuto a minuto (<code>RODADA_HOLD_MIN = 1</code>).</li>
          <li><strong>Formato do Pix:</strong> Código Pix copia-e-cola enviado <em>isolado</em> em mensagem subsequente para cópia imediata em 1 toque no celular.</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "Quase lá, [Nome]! 💚 📍 [Unidade] · 🗓️ [Dia e Hora] · 💰 1ª mensalidade: R$ [Valor] + Taxa: R$ 20. Copie o código Pix abaixo... <b>Consigo segurar essa vaga por 10 minutos.</b>"
        </div>
      </div>

      <!-- Card 2: Lembrete Hold -->
      <div class="card card-highlight">
        <div class="card-header-row">
          <div class="card-title terra">⏳ 2. Lembrete: Vaga Quase Expirando</div>
          <span class="badge-tag tag-terra">Faltando 3 min</span>
        </div>
        <ul class="clean-list">
          <li><strong>Gatilho:</strong> Faltando 3 minutos para o fim do prazo de 10 min (<code>HOLD_AVISO_MIN = 3</code>).</li>
          <li><strong>Proteção Anti-Cobrança Indevida:</strong> Consulta a API do Sicredi antes do disparo; se o Pix já foi pago, anula o lembrete imediatamente.</li>
          <li><strong>Botões interativos:</strong> "💠 Reenviar o Pix" e "Falar com atendente".</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "[Nome], <b>sua vaga sai da reserva em 3 minutos. ⏳</b> Se o Pix não chegou ou deu algum problema, me fala agora que eu resolvo. 💚"
        </div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Card 3: Expiração -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-title">❌ 3. Expiração e Liberação de Vaga</div>
          <span class="badge-tag tag-amber">Ao atingir 10 min</span>
        </div>
        <ul class="clean-list">
          <li><strong>Gatilho:</strong> Completados 10 minutos sem confirmação de pagamento do Pix.</li>
          <li><strong>Ação automática:</strong> A vaga é liberada instantaneamente na grade para outras alunas.</li>
          <li><strong>Remarketing de Leads:</strong> A aluna é mantida na aba <em>Leads (Remarketing)</em> com seus dados salvos para posterior contato comercial da Inêz.</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "[Nome], o prazo da sua reserva de [Data] terminou e a vaga voltou para a lista. 😔 <b>Se você acabou de pagar, fica tranquila: o seu dinheiro não se perde.</b> Me chama aqui que acertamos seu horário."
        </div>
      </div>

      <!-- Card 4: Conversa Parada -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-title">💬 4. Retomada de Conversa Parada</div>
          <span class="badge-tag tag-blue">30 min de silêncio</span>
        </div>
        <ul class="clean-list">
          <li><strong>Gatilho:</strong> Aluna iniciou o agendamento no bot e parou de responder por 30 minutos (<code>INATIVIDADE_MIN = 30</code>).</li>
          <li><strong>Regra Anti-Spam:</strong> Enviada <em>apenas 1 vez</em>. Só atua se a conversa parou há menos de 24h e respeita a janela das 08h às 20h. Não dispara no passo do Pix.</li>
          <li><strong>Botões interativos:</strong> "Continuar", "Recomeçar" e "Falar com atendente".</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "[Nome], você ainda está por aí? 💚 <b>Sua conversa parou na escolha do horário.</b> Posso continuar de onde paramos — é rapidinho. Se preferir recomeçar, digite menu."
        </div>
      </div>
    </div>
  </div>

  <!-- Footer Página 1 -->
  <div class="footer">
    <div>Sistema de Gestão & Agendamento Integrado · <strong>Fios que Curam</strong></div>
    <div>Documento Técnico e Executivo · <strong>Página 1 de 3</strong></div>
  </div>
</div>


<!-- ==================== PÁGINA 2 ==================== -->
<div class="page">
  <div>
    <!-- Top Header -->
    <div class="header">
      <div>
        <div class="brand-title">🧶 Fios que Curam</div>
        <div class="brand-subtitle">Ateliê & Escola de Crochê · Inêz Pimentel | Relatório Executivo do Sistema</div>
      </div>
      <div class="badge-header">
        Confirmações & Regras<br>
        <span style="font-weight:400; font-size:6.6pt; color:#427050;">Pagamentos e Reposições</span>
      </div>
    </div>

    <!-- SEÇÃO 2: CONFIRMAÇÕES DE PAGAMENTO VIA SICREDI -->
    <div class="section-title">
      <span class="sec-num">2</span> Confirmações Automáticas de Pagamento (Tempo Real via Sicredi)
    </div>

    <p style="font-size:7.8pt; color:#5E4A38; margin-bottom:6px;">
      Assim que o Pix é compensado pelo Banco Sicredi, o sistema recebe a notificação instantânea (webhook mTLS) e dispara imediatamente a confirmação específica para o WhatsApp da aluna, eliminando incertezas e evitando contatos manuais repetitivos:
    </p>

    <div class="grid-2">
      <!-- Card Confirmação Matrícula -->
      <div class="card card-green">
        <div class="card-header-row">
          <div class="card-title">🎉 1. Matrícula / 1ª Aula Confirmada</div>
          <span class="badge-tag tag-green">Imediato (tempo real)</span>
        </div>
        <ul class="clean-list">
          <li><strong>Gatilho:</strong> Compensação do Pix da 1ª mensalidade ou aula avulsa.</li>
          <li><strong>Acesso ao Portal da Aluna:</strong> Envia link direto com CPF pré-carregado para criação do <strong>PIN de 4 dígitos</strong> exclusivo da aluna.</li>
          <li><strong>Garantia Transparente:</strong> Reforça que se ela não quiser continuar após a 1ª aula, a mensalidade é devolvida 100% (retendo apenas a taxa).</li>
          <li><strong>Envio do Regulamento:</strong> Transmite integralmente as regras oficiais de reposição e faltas (ver quadro abaixo).</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Trecho da confirmação enviada:</span>
          "Obrigada, [Nome]! 🙏 Recebemos seu pagamento. Vaga garantida em [Unidade] no dia [Data e Hora]. <b>Seu próximo passo: Acesse o Portal da Aluna, digite seu CPF e crie seu PIN de 4 dígitos.</b>"
        </div>
      </div>

      <!-- Card Confirmação Mensalidade e Aula Extra -->
      <div class="card">
        <div class="card-header-row">
          <div class="card-title">🧾 2. Mensalidade & Aula Extra Pagas</div>
          <span class="badge-tag tag-green">Imediato (tempo real)</span>
        </div>
        <ul class="clean-list">
          <li><strong>Mensalidade Recorrente:</strong> Confirma o mês de competência quitado, valor exato e transmite alívio ("nada mais a pagar neste mês").</li>
          <li><strong>Aula Extra (Adquirida no Portal):</strong> Confirma o recebimento e avisa que o passe já está liberado para ela escolher a data na grade.</li>
          <li><strong>Pagamento Tardio (Turma Lotada):</strong> Se a aluna pagou após os 10 min e a vaga foi ocupada por outra pessoa, o robô avisa que o dinheiro está seguro e fornece o contato da Inêz para remarcação imediata.</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Confirmação de mensalidade regular:</span>
          "Recebemos, [Nome]! ✅ <b>Mensalidade de [Mês]: R$ [Valor].</b> Está tudo certo por aqui, nada mais a pagar neste mês. Boas aulas! 🧶💚"
        </div>
      </div>
    </div>

    <!-- SEÇÃO 3: REGRAS CONTRATUAIS TRANSMITIDAS AUTOMATICAMENTE -->
    <div class="section-title" style="margin-top:5px;">
      <span class="sec-num">3</span> Regras Oficiais de Reposição Enviadas no WhatsApp da Aluna
    </div>

    <div class="card" style="background:#FFFDF9; border:1px solid #D8C7B5; padding:7px 10px; margin-bottom:7px;">
      <p style="font-size:7.9pt; color:#3A3228; margin-bottom:4px;">
        As regras abaixo são transmitidas na íntegra para <strong>toda aluna nova assim que o primeiro pagamento cai</strong>, assegurando comprovação jurídica de ciência prévia:
      </p>

      <div class="grid-3" style="margin-bottom:0;">
        <div style="background:#FFFFFF; border:1px solid #E3D9CC; border-radius:5px; padding:5px 7px;">
          <strong style="color:#C2714F; font-size:7.8pt; display:block; margin-bottom:2px;">⏰ Antecedência Mínima</strong>
          <span style="font-size:7.4pt; color:#55493D;">
            • <strong>6 horas antes</strong> para aulas a partir das 10h.<br>
            • <strong>Até 23h59 da véspera</strong> para aulas matutinas (&lt; 10h). Avisos fora do prazo não geram crédito.
          </span>
        </div>

        <div style="background:#FFFFFF; border:1px solid #E3D9CC; border-radius:5px; padding:5px 7px;">
          <strong style="color:#1F6B3A; font-size:7.8pt; display:block; margin-bottom:2px;">📅 Limite e Validade</strong>
          <span style="font-size:7.4pt; color:#55493D;">
            • <strong>Máximo 2 reposições por mês</strong> por aluna.<br>
            • Validade: <strong>Até o fim do mês seguinte</strong>. Após essa data, o crédito expira automaticamente.
          </span>
        </div>

        <div style="background:#FFFFFF; border:1px solid #E3D9CC; border-radius:5px; padding:5px 7px;">
          <strong style="color:#215987; font-size:7.8pt; display:block; margin-bottom:2px;">🚫 Exceções Claras</strong>
          <span style="font-size:7.4pt; color:#55493D;">
            • <strong>Não repomos reposição:</strong> falta na aula de reposição consome o crédito.<br>
            • <strong>Feriados não geram crédito:</strong> mensalidade já é calculada sobre os dias letivos da escola.
          </span>
        </div>
      </div>
    </div>

    <!-- SEÇÃO 4: ROTINAS DE COBRANÇA AUTOMÁTICA -->
    <div class="section-title">
      <span class="sec-num">4</span> Avisos Automáticos de Mensalidade (Rotinas Agendadas)
    </div>

    <div class="grid-2">
      <!-- Aviso a Vencer -->
      <div class="card card-highlight">
        <div class="card-header-row">
          <div class="card-title terra">📅 Aviso de Mensalidade a Vencer</div>
          <span class="badge-tag tag-terra">3 dias antes (D-3)</span>
        </div>
        <ul class="clean-list">
          <li><strong>Prazo de Disparo:</strong> Exatamente 3 dias antes da data de vencimento da fatura (<code>AVISO_ANTES = 3</code>).</li>
          <li><strong>Tom Amigável:</strong> Lembra com gentileza para evitar encargos; envia o Pix copia-e-cola atualizado.</li>
          <li><strong>Template Oficial:</strong> Disparado via modelo Meta <code>mensalidade_a_vencer</code> com botão "Abrir portal".</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "Oi, [Nome]! 💚 Passando só para lembrar, sem pressa: 🧾 <b>Mensalidade de [Mês] · R$ [Valor] · Vence em [Data].</b> Pagando até o vencimento você não paga multa nem juros. Segue o Pix copia-e-cola 👇"
        </div>
      </div>

      <!-- Aviso em Atraso -->
      <div class="card" style="border-left:4px solid #B33927;">
        <div class="card-header-row">
          <div class="card-title" style="color:#B33927;">⚠️ Aviso de Mensalidade em Atraso</div>
          <span class="badge-tag tag-amber">2 dias após (D+2)</span>
        </div>
        <ul class="clean-list">
          <li><strong>Prazo de Disparo:</strong> 2 dias após a data de vencimento sem pagamento (<code>AVISO_ATRASO = 2</code>).</li>
          <li><strong>Cálculo de Encargos:</strong> O robô recalcula na hora a <strong>multa fixa de R$ 5,00</strong> + <strong>juros diários de 0,1%</strong> e gera um novo Pix atualizado no valor corrigido.</li>
          <li><strong>Exclusão Manual:</strong> Mensalidades marcadas como "Sem Pix" (pagas em dinheiro ou por fora) não são cobradas.</li>
        </ul>
        <div class="msg-box">
          <span class="quote-tag">Mensagem enviada à aluna:</span>
          "Oi, [Nome]! Sua mensalidade de [Mês] venceu há 2 dias e ainda consta em aberto. <b>💰 Total com multa e juros: R$ [Valor Corrigido].</b> Segue o Pix atualizado logo abaixo..."
        </div>
      </div>
    </div>

  </div>

  <!-- Footer Página 2 -->
  <div class="footer">
    <div>Sistema de Gestão & Agendamento Integrado · <strong>Fios que Curam</strong></div>
    <div>Documento Técnico e Executivo · <strong>Página 2 de 3</strong></div>
  </div>
</div>


<!-- ==================== PÁGINA 3 ==================== -->
<div class="page">
  <div>
    <!-- Top Header -->
    <div class="header">
      <div>
        <div class="brand-title">🧶 Fios que Curam</div>
        <div class="brand-subtitle">Ateliê & Escola de Crochê · Inêz Pimentel | Relatório Executivo do Sistema</div>
      </div>
      <div class="badge-header">
        Políticas & Resumo<br>
        <span style="font-weight:400; font-size:6.6pt; color:#427050;">Controle Operacional</span>
      </div>
    </div>

    <!-- SEÇÃO 5: OUTRAS AUTOMAÇÕES PERIÓDICAS -->
    <div class="section-title">
      <span class="sec-num">5</span> Lembretes de Aula, Aniversários e Transbordo Humano
    </div>

    <div class="grid-3" style="align-items: stretch;">
      <!-- Aniversário -->
      <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div class="card-header-row">
            <div class="card-title">🎂 Aniversário</div>
            <span class="badge-tag tag-green">No dia (09h)</span>
          </div>
          <p style="font-size:7.4pt; color:#55493D; margin-bottom:4px;">
            Enviada no dia do aniversário cadastrado para todas as alunas ativas (1x por ano).
          </p>
        </div>
        <div class="msg-box" style="margin-top:2px;">
          "Feliz aniversário, [Nome]! 🎉🎂 Que este novo ciclo venha repleto de saúde, alegrias e lindos projetos de crochê! ✨🧶"
        </div>
      </div>

      <!-- Lembrete de Aula -->
      <div class="card" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div class="card-header-row">
            <div class="card-title">🗓️ Lembrete de Aula</div>
            <span class="badge-tag tag-amber">1 dia antes (D-1)</span>
          </div>
          <p style="font-size:7.4pt; color:#55493D; margin-bottom:4px;">
            Lembra horário e unidade com botões <em>Confirmar presença</em> ou <em>Não poderei ir</em> (que já libera a vaga na grade).
          </p>
        </div>
        <div style="font-size:6.8pt; color:#756758; background:#F2EFEB; padding:3px 5px; border-radius:4px; margin-top:2px;">
          *Módulo pronto; mantido em pausa no agendador para otimização de custos de disparo da Meta.
        </div>
      </div>

      <!-- Atendimento Humano -->
      <div class="card card-green" style="display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div class="card-header-row">
            <div class="card-title">👩‍💼 Atendimento Humano</div>
            <span class="badge-tag tag-blue">Na 3ª vez</span>
          </div>
          <p style="font-size:7.4pt; color:#55493D; margin-bottom:4px;">
            O bot atende nas duas primeiras tentativas. Na 3ª, entrega imediatamente o contato oficial da Inêz:
          </p>
        </div>
        <div style="font-weight:700; color:#1F6B3A; font-size:8.2pt; text-align:center; padding:3px; background:#EAF4EE; border-radius:4px; margin-top:2px;">
          📞 +55 31 98496-6403
        </div>
      </div>
    </div>

    <!-- SEÇÃO 6: TABELA COMPLETA DE REGRAS E PRAZOS -->
    <div class="section-title" style="margin-top:5px;">
      <span class="sec-num">6</span> Tabela Consolidada de Disparos Automáticos e Prazos
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width:23%;">Mensagem / Disparo</th>
          <th style="width:23%;">Gatilho Operacional</th>
          <th style="width:18%;">Prazo / Tolerância</th>
          <th style="width:22%;">Janela de Disparo</th>
          <th style="width:14%;">Canal / Tipo</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Envio do Pix da Reserva</strong></td>
          <td>Conclusão da escolha de turma no bot</td>
          <td><strong>10 minutos</strong> de reserva</td>
          <td>Imediato (24h por dia)</td>
          <td><span class="badge-tag tag-green">Meta Livre</span></td>
        </tr>
        <tr>
          <td><strong>Lembrete de Vaga Quase Expirando</strong></td>
          <td>Fila de reservas pendentes</td>
          <td><strong>Faltando 3 minutos</strong></td>
          <td>Imediato no tempo da aluna</td>
          <td><span class="badge-tag tag-green">Botões Interativos</span></td>
        </tr>
        <tr>
          <td><strong>Aviso de Reserva Expirada</strong></td>
          <td>Ausência de confirmação do Pix</td>
          <td><strong>Exatamente 10 min</strong></td>
          <td>Imediato (move para Leads)</td>
          <td><span class="badge-tag tag-green">Meta Livre</span></td>
        </tr>
        <tr>
          <td><strong>Confirmação de Matrícula / 1ª Aula</strong></td>
          <td>Compensação do Pix no Sicredi</td>
          <td><strong>Imediato</strong> (segundos)</td>
          <td>24h (assim que o banco aprova)</td>
          <td><span class="badge-tag tag-green">Texto + Regras</span></td>
        </tr>
        <tr>
          <td><strong>Confirmação de Mensalidade / Aula Extra</strong></td>
          <td>Compensação do Pix de fatura/passe</td>
          <td><strong>Imediato</strong> (segundos)</td>
          <td>24h (assim que o banco aprova)</td>
          <td><span class="badge-tag tag-green">Comprovante Pix</span></td>
        </tr>
        <tr>
          <td><strong>Retomada de Conversa Parada</strong></td>
          <td>Aluna sumiu no meio do cadastro</td>
          <td><strong>Após 30 minutos</strong></td>
          <td>08:00 às 20:00 (1 única vez)</td>
          <td><span class="badge-tag tag-green">Botões Interativos</span></td>
        </tr>
        <tr>
          <td><strong>Expiração Total de Sessão no Bot</strong></td>
          <td>Inatividade na conversa</td>
          <td><strong>Após 12 horas</strong></td>
          <td>Reseta estado da conversa</td>
          <td><span class="badge-tag tag-blue">Regra Interna</span></td>
        </tr>
        <tr>
          <td><strong>Aviso de Mensalidade a Vencer</strong></td>
          <td>Rotina matinal de faturas em aberto</td>
          <td><strong>3 dias antes (D-3)</strong></td>
          <td>08:00 às 20:00 (1 vez por fatura)</td>
          <td><span class="badge-tag tag-terra">Template Oficial</span></td>
        </tr>
        <tr>
          <td><strong>Aviso de Mensalidade em Atraso</strong></td>
          <td>Rotina de faturas não pagas</td>
          <td><strong>2 dias após (D+2)</strong></td>
          <td>08:00 às 20:00 (com multa/juros)</td>
          <td><span class="badge-tag tag-terra">Template Oficial</span></td>
        </tr>
        <tr>
          <td><strong>Felicitações de Aniversário</strong></td>
          <td>Data de aniversário da aluna ativa</td>
          <td><strong>No dia (09:00)</strong></td>
          <td>08:00 às 20:00 (1 vez por ano)</td>
          <td><span class="badge-tag tag-green">Meta Livre/Oficial</span></td>
        </tr>
        <tr>
          <td><strong>Lembrete de Véspera de Aula</strong></td>
          <td>Aulas agendadas para o dia seguinte</td>
          <td><strong>1 dia antes (D-1)</strong></td>
          <td>08:00 às 20:00 (Módulo pronto)</td>
          <td><span class="badge-tag tag-amber">Pausado (Custo)</span></td>
        </tr>
      </tbody>
    </table>

    <!-- SEÇÃO 7: POLÍTICAS DE PROTEÇÃO E CUSTOS META -->
    <div class="section-title" style="margin-top:5px;">
      <span class="sec-num">7</span> Diretrizes de Segurança, Proteção Anti-Bloqueio e Economia
    </div>

    <div class="grid-2">
      <div class="card" style="font-size:7.5pt;">
        <strong style="color:#1F6B3A; display:block; margin-bottom:2px;">🛡️ Janela de Silêncio e Proteção do Número</strong>
        • <strong>Horário Protegido (08:00 às 20:00):</strong> Nenhuma mensagem ativa ou de cobrança é disparada durante a noite ou madrugada, garantindo respeito à aluna e evitando denúncias de spam.<br>
        • <strong>Proteção Anti-Spam:</strong> Mensagens de abandono e cobrança são limitadas a 1 envio por evento, preservando a reputação do chip junto à Meta.
      </div>

      <div class="card" style="font-size:7.5pt;">
        <strong style="color:#C2714F; display:block; margin-bottom:2px;">💰 Categoria UTILITY e Otimização de Custos</strong>
        • <strong>Categoria UTILITY da Meta:</strong> Todos os templates foram desenhados estritamente na categoria utilidade (~R$ 0,04 por envio fora da janela), sem teor de marketing.<br>
        • <strong>Gratuidade na Janela de 24h:</strong> Quando a aluna fala primeiro com a escola, todas as mensagens enviadas em até 24h são 100% gratuitas pela Meta.
      </div>
    </div>

  </div>

  <!-- Footer Página 3 -->
  <div class="footer">
    <div>Sistema de Gestão & Agendamento Integrado · <strong>Fios que Curam</strong></div>
    <div>Documento Técnico e Executivo · <strong>Página 3 de 3</strong></div>
  </div>
</div>

</body>
</html>
"""

html_path = os.path.abspath("relatorio_whatsapp_automacoes.html")
pdf_path = os.path.abspath("Relatorio_Automacoes_WhatsApp_Fios_que_Curam.pdf")

with open(html_path, "w", encoding="utf-8") as f:
    f.write(html_content)

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chrome_path = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
browser_path = edge_path if os.path.exists(edge_path) else chrome_path

temp_user_data = os.path.join(os.environ.get("TEMP", "C:\\Temp"), "msedge_pdf_render")
os.makedirs(temp_user_data, exist_ok=True)

cmd = [
    browser_path,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    f"--user-data-dir={temp_user_data}",
    "--no-pdf-header-footer",
    f"--print-to-pdf={pdf_path}",
    f"file:///{html_path.replace(os.sep, '/')}"
]

subprocess.run(cmd, capture_output=True, text=True)
print(f"OK_PDF:{pdf_path}:{os.path.getsize(pdf_path)}")
shutil.rmtree(temp_user_data, ignore_errors=True)
