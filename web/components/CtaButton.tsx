import { Button, cn, LinkButton, type ButtonProps, type LinkButtonProps } from "@cloudflare/kumo";
import { DashedLoader } from "./DashedLoader";

/**
 * Kumo's `loading` prop draws its own spinner. Spread this instead so a busy button shows our `DashedLoader` in
 * place of its icon and can't be clicked again: `<Button {...loadingProps(busy, Icon, disabled)}>`.
 */
export function loadingProps(loading: boolean | undefined, icon: ButtonProps["icon"], disabled?: boolean) {
  return loading
    ? { loading: false, disabled: true, "aria-busy": true, icon: <DashedLoader size={14} label={null} /> }
    : { loading: false, disabled, icon };
}

/**
 * The app's main action: Kumo's primary (Cloudflare orange) button as a pill (TDD §12.2, §12.4).
 * Same props as Kumo's `Button`; `variant` is fixed; `loading` shows the dashed loader.
 */
export function CtaButton({ className, loading, icon, disabled, ...props }: ButtonProps) {
  return <Button {...props} {...loadingProps(loading, icon, disabled)} variant="primary" className={cn("justify-center rounded-full", className)} />;
}

/** `CtaButton` that navigates (an anchor), for links such as "New incident". */
export function CtaLinkButton({ className, ...props }: LinkButtonProps) {
  return <LinkButton {...props} variant="primary" className={cn("justify-center rounded-full", className)} />;
}
