/** The CAM workspace fills the window: no site header, no page scroll. */
export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <div className="flex h-dvh flex-col overflow-hidden">{children}</div>;
}
