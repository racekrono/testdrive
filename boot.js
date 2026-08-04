// Race Krono — orquestrador offline-first
// Carrega DB, sync e GPS background. Restaura sessão antes de qualquer coisa.

import {
  salvarSessao,
  lerSessao,
  salvarOdometro,
  salvarRoadbookLocal,
  lerRoadbookLocal,
  limparOffline,
} from "./db.js";
import {
  registrarPontoGps,
  drenarFila,
  enviarDataloggerCompleto,
} from "./sync.js";
import { iniciarGpsNativo, pararGpsNativo } from "./gps-bg.js";

// Expor API global para o index.html consumir
window.__rk = window.__rk || {};
Object.assign(window.__rk, {
  salvarSessao, lerSessao, salvarOdometro, salvarRoadbookLocal, lerRoadbookLocal, limparOffline,
  registrarPontoGps, drenarFila, enviarDataloggerCompleto,
  iniciarGpsNativo, pararGpsNativo,
});
window.__rk._booted = true;
console.log("[boot.js] Módulo offline carregado:", Object.keys(window.__rk));
try { window.dispatchEvent(new CustomEvent("rk:ready")); } catch (_) {}

// === Restauração de sessão ao iniciar ===
async function restaurarSessao() {
  const sessao = await lerSessao();
  const localCarro = localStorage.getItem("rally_carro_ativo");

  // Prioriza IndexedDB; sincroniza localStorage como espelho
  const carro = (sessao && sessao.carro) || localCarro;
  if (!carro) return;

  // Garante consistência localStorage ↔ IndexedDB
  if (sessao && sessao.carro && !localCarro) {
    localStorage.setItem("rally_carro_ativo", String(sessao.carro));
    if (sessao.login) localStorage.setItem("rally_timestamp_login", String(sessao.login));
  }
  if (!sessao && localCarro) {
    await salvarSessao({
      carro: parseInt(localCarro),
      login: parseInt(localStorage.getItem("rally_timestamp_login") || Date.now()),
    });
  }

  // Verifica logoff remoto SOMENTE se houver internet (não bloqueia offline)
  const db = window.__rk.db;
  let bloqueadoPorLogoff = false;
  if (navigator.onLine && db) {
    try {
      const snap = await Promise.race([
        db.ref("configuracoes/comandoLogoff").once("value"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
      const tsLogoff = snap.val() || 0;
      const tsLogin = parseInt(localStorage.getItem("rally_timestamp_login") || 0);
      if (tsLogoff > tsLogin) {
        bloqueadoPorLogoff = true;
      }
    } catch (_) {
      // sem internet ou timeout — segue offline
    }
  }

  if (bloqueadoPorLogoff) {
    await limparOffline();
    localStorage.removeItem("rally_carro_ativo");
    localStorage.removeItem("rally_timestamp_login");
    return;
  }

  // Restaura tela ativa
  window.__rk.iniciarFluxoRastreio(parseInt(carro));
  window.__rk.carregarRoadbook();

  // Restaura odômetro
  if (sessao && typeof sessao.odometro === "number") {
    window.__rk.aplicarOdometroRestaurado(sessao.odometro);
  }

  // Drena fila pendente em background
  setTimeout(() => drenarFila().catch(() => {}), 2000);
}

// Reage a online/offline para drenar fila
window.addEventListener("online", () => {
  drenarFila().catch(() => {});
});

// Aguarda Firebase compat estar pronto + DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => restaurarSessao().catch(console.error));
} else {
  restaurarSessao().catch(console.error);
}
