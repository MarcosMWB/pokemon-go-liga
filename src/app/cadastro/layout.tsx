export default function CadastroLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      {children}
    </div>
  );
}