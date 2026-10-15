import { Button, cn, LinkButton, type ButtonProps, type LinkButtonProps } from "@cloudflare/kumo";

/**
 * The app's main action: Kumo's primary (Cloudflare orange) button as a pill (TDD §12.2, §12.4).
 * Same props as Kumo's `Button`; `variant` is fixed.
 */
export function CtaButton({ className, ...props }: ButtonProps) {
  return <Button {...props} variant="primary" className={cn("justify-center rounded-full", className)} />;
}

/** `CtaButton` that navigates (an anchor), for links such as "New incident". */
export function CtaLinkButton({ className, ...props }: LinkButtonProps) {
  return <LinkButton {...props} variant="primary" className={cn("justify-center rounded-full", className)} />;
}
