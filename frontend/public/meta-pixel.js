/* Pixel da Meta (anúncios). Carregado pela landing (/) e pelo SPA.
   Só roda nas telas públicas de captação — o painel da Inêz e o portal da
   aluna ficam de fora, para não misturar uso interno com o público do anúncio.
   Os eventos com dinheiro (Lead, Purchase) também saem pelo backend
   (backend/src/metaCapi.js) com o mesmo eventID, e a Meta conta uma vez só. */
(function () {
  var PIXEL_ID = "1398547071106340";
  var p = location.pathname.replace(/\/+$/, "") || "/";
  var rastreia = p === "/" || p === "/landing.html" || p === "/agendar";
  if (!rastreia || window.fbq) return;

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq("init", PIXEL_ID);
  fbq("track", "PageView");

  // Clique em qualquer link de WhatsApp = Contact (a landing tem vários).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href*="wa.me"]');
    if (a) fbq("track", "Contact");
  }, true);
})();

// Uso no código: window.metaTrack("Lead", { currency: "BRL" }, "lead-123")
window.metaTrack = function (evento, params, eventID) {
  if (!window.fbq) return;
  try { window.fbq("track", evento, params || {}, eventID ? { eventID: eventID } : undefined); } catch (e) {}
};
