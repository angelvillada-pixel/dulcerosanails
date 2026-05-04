import { db, doc, getDoc } from './firebase.js';

const ADMIN_AI_ENDPOINT = 'https://tu-api.onrender.com/ai/chat';

let conversation = [];

export async function initAIAssistant() {
  const container = document.createElement('div');
  container.id = 'ai-assistant-panel';
  container.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; width: 380px; height: 520px;
    background: #1a1a1a; border: 1px solid #9B3A5A; border-radius: 16px;
    display: none; flex-direction: column; z-index: 10000; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
    font-family: 'DM Sans', sans-serif; color: #fff;
  `;

  container.innerHTML = `
    <div style="padding:12px 16px;background:#9B3A5A;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center;">
      <strong>🌸 Rosa AI - Asistente Técnico</strong>
      <button onclick="toggleAI()" style="background:none;border:none;color:white;font-size:1.4rem;cursor:pointer;">✕</button>
    </div>
    <div id="ai-chat" style="flex:1;padding:16px;overflow-y:auto;background:#111;display:flex;flex-direction:column;gap:12px;"></div>
    <div style="padding:12px;border-top:1px solid #333;display:flex;gap:8px;">
      <input id="ai-input" type="text" placeholder="Ej: Añade sistema de recordatorios por WhatsApp..." 
             style="flex:1;padding:12px;border-radius:8px;border:1px solid #444;background:#222;color:white;"/>
      <button onclick="sendAIRequest()" style="padding:0 20px;background:#9B3A5A;border:none;border-radius:8px;color:white;cursor:pointer;">Enviar</button>
    </div>
  `;

  document.body.appendChild(container);
  window.toggleAI = () => { container.style.display = container.style.display === 'flex' ? 'none' : 'flex'; };
  window.sendAIRequest = sendAIRequest;
}

async function sendAIRequest() {
  const input = document.getElementById('ai-input');
  const chat = document.getElementById('ai-chat');
  const message = input.value.trim();
  if (!message) return;

  chat.innerHTML += `<div style="align-self:flex-end;background:#9B3A5A;padding:10px 14px;border-radius:12px;max-width:80%;">${escapeHtml(message)}</div>`;
  input.value = '';

  const loading = document.createElement('div');
  loading.textContent = 'Rosa AI pensando...';
  loading.style.opacity = '0.7';
  chat.appendChild(loading);
  chat.scrollTop = chat.scrollHeight;

  try {
    const response = await fetch(ADMIN_AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.__adminToken || ''}` },
      body: JSON.stringify({
        message,
        history: conversation.slice(-10),
        context: 'dulcerosanails + dulce-rosa-api'
      })
    });

    const data = await response.json();
    conversation.push({ role: 'user', content: message });
    conversation.push({ role: 'assistant', content: data.reply });

    loading.remove();
    chat.innerHTML += `<div style="align-self:flex-start;background:#222;padding:10px 14px;border-radius:12px;max-width:80%;">${escapeHtml(data.reply)}</div>`;
    chat.scrollTop = chat.scrollHeight;
  } catch (e) {
    loading.textContent = 'Error de conexión con Rosa AI.';
  }
}

function escapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
