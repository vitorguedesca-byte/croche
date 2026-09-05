import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");
const UNDO_FILE = path.join(DATA_DIR, "undo-history.json");

// Garante que o diretório data existe
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error("[undo] Falha ao criar diretório data:", err);
  }
}

const MAX_STACK = 50;

let undoStack = [];
let clientBackups = {}; // clientId -> backup

function loadFromDisk() {
  try {
    if (fs.existsSync(UNDO_FILE)) {
      const raw = fs.readFileSync(UNDO_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.undoStack)) undoStack = parsed.undoStack;
      if (parsed.clientBackups && typeof parsed.clientBackups === "object") {
        clientBackups = parsed.clientBackups;
      }
    }
  } catch (err) {
    console.warn("[undo] Erro ao carregar histórico do disco:", err.message);
  }
}

function saveToDisk() {
  try {
    const payload = JSON.stringify({ undoStack, clientBackups }, null, 2);
    fs.writeFileSync(UNDO_FILE, payload, "utf-8");
  } catch (err) {
    console.warn("[undo] Erro ao salvar histórico no disco:", err.message);
  }
}

loadFromDisk();

export const undoManager = {
  pushAction(action) {
    undoStack.push({
      ...action,
      id: "undo_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
    });
    if (undoStack.length > MAX_STACK) {
      undoStack.shift();
    }
    saveToDisk();
  },

  popAction() {
    if (!undoStack.length) return null;
    const action = undoStack.pop();
    saveToDisk();
    return action;
  },

  peekAction() {
    if (!undoStack.length) return null;
    return undoStack[undoStack.length - 1];
  },

  saveClientBackup(clientId, backupData) {
    clientBackups[String(clientId)] = {
      ...backupData,
      updatedAt: new Date().toISOString(),
    };
    saveToDisk();
  },

  getClientBackup(clientId) {
    return clientBackups[String(clientId)] || null;
  },

  removeClientBackup(clientId) {
    delete clientBackups[String(clientId)];
    saveToDisk();
  },

  getStatus() {
    const last = this.peekAction();
    return {
      canUndo: !!last,
      count: undoStack.length,
      lastAction: last
        ? {
            id: last.id,
            type: last.type,
            clientName: last.client?.name || last.clientName,
            description: last.description || "Ação reversível",
            createdAt: last.createdAt,
          }
        : null,
    };
  },
};
