/**
 * Auditoria e kill-switch da inserção de minutas no SEI.
 *
 * Fase D.4 — cada tentativa de inserção (sucesso ou falha) produz um
 * registro em `chrome.storage.local.seirtao_audit_log` (ring buffer de
 * até 100 entradas). O conteúdo da minuta NÃO é gravado — só um hash
 * SHA-256 (truncado em 16 hex chars) para permitir correlação sem
 * vazar o texto. Nenhuma telemetria externa: tudo fica no perfil local
 * do Chrome do usuário. Permite auditoria posterior (quem/quando/o quê,
 * sem conteúdo) e atende às exigências do CNJ quanto a rastreabilidade
 * de ações automatizadas.
 *
 * Fase D.5 — kill-switch em `chrome.storage.sync.seirtao_auto_insert_enabled`
 * (default `false`). A automação só roda quando explicitamente habilitada
 * pelo usuário nas Options; caso contrário, o orquestrador aborta antes
 * de qualquer interação com o SEI.
 */

const LOG = '[SEIrtão/audit]';

const KEY_AUDIT_LOG = 'seirtao_audit_log';
const KEY_KILL_SWITCH = 'seirtao_auto_insert_enabled';
const MAX_AUDIT_ENTRIES = 100;

export interface AuditEntry {
  timestamp: string;
  processo: string | null;
  atoTipo: string;
  descricao: string;
  nivelAcesso: 'publico' | 'restrito' | 'sigiloso';
  hipoteseLegal?: string;
  minutaSize: number;
  /** SHA-256 da minuta, em hex, truncado em 16 caracteres. */
  minutaHashPrefix: string;
  outcome: 'done' | 'error';
  /** Preenchido apenas em outcome='error'. */
  failedAt?: string;
  /** Preenchido apenas em outcome='error'. */
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Hash (Web Crypto — disponível no content script em MV3)
// ─────────────────────────────────────────────────────────────────────────

export async function sha256HexPrefix(text: string, prefixLen = 16): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, prefixLen);
  } catch (err) {
    console.warn(`${LOG} SHA-256 falhou:`, err);
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Kill-switch (chrome.storage.sync)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Retorna `true` somente se o usuário explicitamente habilitou o
 * auto-insert nas Options. Qualquer erro/ausência de chrome.storage
 * retorna `false` (fail-closed — default seguro).
 */
export async function isAutoInsertEnabled(): Promise<boolean> {
  try {
    const api = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    if (!api?.storage?.sync) return false;
    const res = await api.storage.sync.get(KEY_KILL_SWITCH) as Record<string, unknown>;
    return res[KEY_KILL_SWITCH] === true;
  } catch (err) {
    console.warn(`${LOG} leitura do kill-switch falhou (fail-closed):`, err);
    return false;
  }
}

/** Útil para a UI das Options. Não é chamado pelo content script. */
export async function setAutoInsertEnabled(enabled: boolean): Promise<void> {
  try {
    const api = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    await api?.storage?.sync?.set({ [KEY_KILL_SWITCH]: !!enabled });
  } catch (err) {
    console.warn(`${LOG} escrita do kill-switch falhou:`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Ring buffer de auditoria (chrome.storage.local)
// ─────────────────────────────────────────────────────────────────────────

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    const api = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    if (!api?.storage?.local) return;
    const res = await api.storage.local.get(KEY_AUDIT_LOG) as Record<string, unknown>;
    const raw = res[KEY_AUDIT_LOG];
    const existing: AuditEntry[] = Array.isArray(raw) ? (raw as AuditEntry[]) : [];
    existing.push(entry);
    const trimmed = existing.slice(-MAX_AUDIT_ENTRIES);
    await api.storage.local.set({ [KEY_AUDIT_LOG]: trimmed });
  } catch (err) {
    console.warn(`${LOG} falha gravando audit log:`, err);
  }
}

/** Lê o log completo (para futura UI de auditoria nas Options). */
export async function readAuditLog(): Promise<AuditEntry[]> {
  try {
    const api = (globalThis as unknown as { chrome?: typeof chrome }).chrome;
    if (!api?.storage?.local) return [];
    const res = await api.storage.local.get(KEY_AUDIT_LOG) as Record<string, unknown>;
    const raw = res[KEY_AUDIT_LOG];
    return Array.isArray(raw) ? (raw as AuditEntry[]) : [];
  } catch (err) {
    console.warn(`${LOG} leitura do audit log falhou:`, err);
    return [];
  }
}
