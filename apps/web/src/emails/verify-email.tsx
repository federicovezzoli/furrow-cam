import { EmailLayout, EmailText } from "./layout";

export interface VerifyEmailProps {
  url: string;
}

export const verifyEmailSubject = "Verify your Furrow CAM email";

export default function VerifyEmail({ url }: VerifyEmailProps) {
  return (
    <EmailLayout
      preview="Confirm your email address to finish signing up."
      action={{ label: "Verify email", url }}
      reason="You received this email because this address was used to sign up for Furrow CAM. If that wasn't you, you can ignore it."
    >
      <EmailText>Confirm your email address to finish creating your Furrow CAM account.</EmailText>
    </EmailLayout>
  );
}

VerifyEmail.PreviewProps = {
  url: "http://localhost:3000/api/auth/verify-email?token=preview",
} satisfies VerifyEmailProps;
