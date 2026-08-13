"use client";

import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";
import type { ReactNode } from "react";

const easeOut = [0.22, 1, 0.36, 1] as const;

export const pageTransition = {
  duration: 0.32,
  ease: easeOut,
};

export const appearTransition = {
  duration: 0.55,
  ease: easeOut,
};

export const appearContainerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.09,
      delayChildren: 0.06,
    },
  },
};

export const appearItemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: appearTransition,
  },
};

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

/** Full-page enter/exit shell for AnimatePresence route swaps. */
export function PageShell({ children, className }: PageShellProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={["page-shell", className].filter(Boolean).join(" ")}
      initial={false}
      animate={{ opacity: 1 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={
        reduced
          ? { duration: 0 }
          : pageTransition
      }
    >
      {children}
    </motion.div>
  );
}

type AppearProps = {
  children: ReactNode;
  className?: string;
} & Omit<HTMLMotionProps<"div">, "children" | "variants" | "initial" | "animate">;

/** Staggered appear group for first-paint content. */
export function Appear({ children, className, ...props }: AppearProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      className={className}
      variants={appearContainerVariants}
      initial={false}
      animate="show"
      {...props}
    >
      {children}
    </motion.div>
  );
}

type AppearItemProps = {
  children: ReactNode;
  className?: string;
  as?: "div" | "h1" | "p" | "nav";
} & Omit<HTMLMotionProps<"div">, "children" | "variants" | "initial" | "animate" | "as">;

/** Single staggered child inside an Appear group. */
export function AppearItem({
  children,
  className,
  as = "div",
  ...props
}: AppearItemProps) {
  const reduced = useReducedMotion();
  const Component = motion[as];

  return (
    <Component
      className={className}
      variants={reduced ? undefined : appearItemVariants}
      {...props}
    >
      {children}
    </Component>
  );
}
