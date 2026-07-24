declare module "pannellum";

interface Window {
  pannellum: {
    viewer(
      element: HTMLElement,
      config: Pannellum.ConfigOptions,
    ): Pannellum.Viewer;
  };
}
