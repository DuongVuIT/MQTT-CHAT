import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChatMarkIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M5.5 6.5h9a3 3 0 0 1 3 3v3.2a3 3 0 0 1-3 3H10l-3.6 2.8.8-2.8H5.5a3 3 0 0 1-3-3V9.5a3 3 0 0 1 3-3Z" />
      <path d="M8 10.2h6M8 13h3.6" />
      <path d="M8 6.5V5.3a2.8 2.8 0 0 1 2.8-2.8h7.7a3 3 0 0 1 3 3v2.8a3 3 0 0 1-3 3h-1" />
    </IconFrame>
  );
}

export function MenuIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconFrame>
  );
}

export function ChevronRightIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m9 5 7 7-7 7" />
    </IconFrame>
  );
}

export function ChevronLeftIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m15 5-7 7 7 7" />
    </IconFrame>
  );
}

export function InfoIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </IconFrame>
  );
}

export function PaperclipIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m8.5 12.5 6.4-6.4a3 3 0 0 1 4.2 4.2l-8 8a5 5 0 0 1-7.1-7.1l7.7-7.7" />
    </IconFrame>
  );
}

export function SendIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="m21 3-7.1 18-4-7-7-4L21 3Z" />
      <path d="m9.9 14 4-4" />
    </IconFrame>
  );
}

export function FileIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <path d="M6 2.8h7l5 5V21H6z" />
      <path d="M13 2.8V8h5M9 13h6M9 16h5" />
    </IconFrame>
  );
}

export function ImageIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m5.5 17 4.2-4.2 3.1 3 2.1-2.1 3.6 3.3" />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps): React.JSX.Element {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </IconFrame>
  );
}
