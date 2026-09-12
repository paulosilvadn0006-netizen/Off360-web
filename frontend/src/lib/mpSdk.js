// Carrega o SDK MercadoPago.js v2 uma única vez e cria a instância com a public key.
let scriptPromise = null;

function loadScript() {
  if (window.MercadoPago) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://sdk.mercadopago.com/js/v2";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Falha ao carregar o SDK do Mercado Pago"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export async function loadMp(publicKey) {
  await loadScript();
  return new window.MercadoPago(publicKey, { locale: "pt-BR" });
}
