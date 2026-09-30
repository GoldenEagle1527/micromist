/** Browser binding: write the save when the page is hidden or unloaded (phones kill hidden tabs). */
export function flushOnPageHide(flush: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") flush();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
