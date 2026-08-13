import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./app";
import { renderSeoHead, seoRoutes } from "./seo";

export { seoRoutes };

export function renderPage(pathname: string) {
  return {
    appHtml: renderToString(
      <StrictMode>
        <App initialPath={pathname} />
      </StrictMode>,
    ),
    headHtml: renderSeoHead(pathname),
  };
}
