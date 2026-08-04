import "./globals.css";

export const metadata = {
  title: "AED Readiness Campaign by Think Health",
  description: "PREPARED score audit for AED readiness across Think Health properties.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
