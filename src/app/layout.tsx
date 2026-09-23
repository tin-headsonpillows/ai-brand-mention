import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const euclidCircularA = localFont({
  src: [
    { path: "../fonts/euclid-circular-a/euclid-circular-a-light.ttf", weight: "300", style: "normal" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-light-italic.ttf", weight: "300", style: "italic" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-italic.ttf", weight: "400", style: "italic" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-medium-italic.ttf", weight: "500", style: "italic" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-semibold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-semibold-italic.ttf", weight: "600", style: "italic" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/euclid-circular-a/euclid-circular-a-bold-italic.ttf", weight: "700", style: "italic" },
  ],
  variable: "--font-euclid",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Brand Mention Tracker",
  description: "Track how often your brand gets mentioned by ChatGPT across similar prompts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${euclidCircularA.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
