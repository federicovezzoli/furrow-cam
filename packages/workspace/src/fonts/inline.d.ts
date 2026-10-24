// Test fixtures: Vite inlines a font as a data URL.
declare module "*.ttf?inline" {
  const dataUrl: string;
  export default dataUrl;
}
