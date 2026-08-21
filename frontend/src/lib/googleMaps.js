// Loader único do Google Maps JavaScript API (carrega o script uma vez).
let promise = null;

export function loadGoogleMaps() {
  if (typeof window !== "undefined" && window.google && window.google.maps) {
    return Promise.resolve(window.google.maps);
  }
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const key = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    if (!key) { reject(new Error("Google Maps API key ausente")); return; }
    window.__offGmapsCb = () => resolve(window.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&language=pt-BR&region=BR&callback=__offGmapsCb`;
    s.async = true;
    s.defer = true;
    s.onerror = () => { promise = null; reject(new Error("Falha ao carregar o Google Maps")); };
    document.head.appendChild(s);
  });
  return promise;
}
