/**
 * The CAM workspace fills the window: no site header, no page scroll. Relative,
 * so absolute descendants are clipped here instead of growing the page.
 */
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <div className="relative flex h-dvh flex-col overflow-hidden">{children}</div>;
}
