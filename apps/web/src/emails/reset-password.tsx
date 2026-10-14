import { EmailLayout, EmailText } from "./layout";

export interface ResetPasswordProps {
  url: string;
}

export const resetPasswordSubject = "Reset your Furrow CAM password";

export default function ResetPassword({ url }: ResetPasswordProps) {
  return (
    <EmailLayout
      preview="Choose a new password for your Furrow CAM account."
      action={{ label: "Choose a new password", url }}
      reason="You received this email because a password reset was requested for this address on Furrow CAM. If that wasn't you, you can ignore it; your password stays the same."
    >
      <EmailText>Someone asked to reset the password for your Furrow CAM account.</EmailText>
      <EmailText>Open the link below to choose a new one.</EmailText>
    </EmailLayout>
  );
}

ResetPassword.PreviewProps = {
  url: "http://localhost:3000/reset-password?token=preview",
} satisfies ResetPasswordProps;
