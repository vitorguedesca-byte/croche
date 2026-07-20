import { useEffect, useState } from "react";
import QRCode from "qrcode";

/* QR Code do Pix copia-e-cola.
   No tablet da sala a aluna não consegue colar o código no banco dela — ela
   aponta a câmera do celular para cá. Por isso o QR precisa ser grande. */
export default function PixQR({ code, size = 260, legenda }) {
  const [img, setImg] = useState("");
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    if (!code) { setImg(""); return; }
    QRCode.toDataURL(code, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => { if (vivo) { setImg(url); setErro(""); } })
      .catch(() => { if (vivo) setErro("Não consegui gerar o QR Code."); });
    return () => { vivo = false; };
  }, [code, size]);

  if (!code) return null;
  if (erro) return <div className="pt-hint">{erro} Use o código copia-e-cola abaixo.</div>;
  if (!img) return <div className="pt-qr-box" style={{ width: size, height: size }} />;

  return (
    <div className="pt-qr-wrap">
      <img className="pt-qr" src={img} alt="QR Code do Pix" width={size} height={size} />
      {legenda && <div className="pt-qr-legenda">{legenda}</div>}
    </div>
  );
}
