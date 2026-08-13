"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type NavigateOptions = {
  replace?: boolean;
};

type RouterContextValue = {
  path: string;
  navigate: (to: string, options?: NavigateOptions) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

function normalizePath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

export function Router({
  children,
  initialPath,
}: {
  children: ReactNode;
  initialPath?: string;
}) {
  const [path, setPath] = useState(() =>
    normalizePath(
      initialPath ?? (typeof window === "undefined" ? "/" : window.location.pathname),
    ),
  );

  useEffect(() => {
    const onPopState = () => {
      setPath(normalizePath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const next = normalizePath(to);
    if (normalizePath(window.location.pathname) === next) {
      setPath(next);
      return;
    }
    if (options?.replace) {
      window.history.replaceState({}, "", next);
    } else {
      window.history.pushState({}, "", next);
    }
    setPath(next);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error("useRouter must be used within Router");
  }
  return context;
}

export function Link({
  to,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const { navigate } = useRouter();

  return (
    <a
      href={to}
      className={className}
      aria-label={ariaLabel}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
