/* Origem da visita — para o funil de leads (14/10/2026).

   Guarda de onde a pessoa chegou ao site: a UTM do link do anúncio, o
   fbclid/gclid e o site de onde veio. Quando ela marca a 1ª aula no /agendar,
   a reserva leva isso junto (FirstClassBooking.jsx → `utm`) e o painel mostra
   na lead "veio do anúncio X".

   Fica só no navegador dela, por 30 dias. Visita sem pista (digitou o
   endereço, voltou pelo histórico) não apaga a anterior: a pista que vale é a
   do último link que a trouxe. Só nas telas públicas de captação — o painel
   da Inêz e o portal da aluna ficam de fora, como no Pixel. */
(function () {
  try {
    var p = location.pathname.replace(/\/+$/, "") || "/";
    if (!(p === "/" || p === "/landing.html" || p === "/agendar")) return;
    var q = new URLSearchParams(location.search);
    var v = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach(function (k) {
      var x = q.get(k);
      if (x) v[k] = x.slice(0, 150);
    });
    var ref = document.referrer || "";
    if (ref && ref.indexOf(location.host) === -1) v.referrer = ref.slice(0, 150);
    if (!Object.keys(v).length) return;
    v.landing = p;
    v.em = new Date().toISOString().slice(0, 10);
    localStorage.setItem("fqc_visita", JSON.stringify(v));
  } catch (e) {}
})();

// Uso no código: window.fqcVisita() → { utm_source, …, referrer, landing, em } ou null
window.fqcVisita = function () {
  try {
    var v = JSON.parse(localStorage.getItem("fqc_visita") || "null");
    if (!v || !v.em || Date.now() - new Date(v.em).getTime() > 30 * 86400000) return null;
    return v;
  } catch (e) {
    return null;
  }
};
