import crypto from "node:crypto";
import express from "express";

// O token de verificação do GET não autentica as notificações do POST.
// A Meta assina os bytes originais com o segredo do aplicativo.
export function waWebhookJson({ secret = process.env.WA_APP_SECRET || "" } = {}) {
  const json = express.json({
    inflate: false,
    verify(req, _res, bytes) { req.waRawBody = bytes; },
  });
  return [json, (req, res, next) => {
    if (!secret) return res.status(503).json({ error: "Recebimento do WhatsApp indisponível." });
    const signature = req.get("x-hub-signature-256");
    if (!Buffer.isBuffer(req.waRawBody) || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(signature)) {
      return res.status(401).json({ error: "Assinatura do WhatsApp inválida." });
    }
    const expected = crypto.createHmac("sha256", secret).update(req.waRawBody).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) {
      return res.status(401).json({ error: "Assinatura do WhatsApp inválida." });
    }
    next();
  }];
}
