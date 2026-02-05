import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-72px)] bg-dark flex flex-col items-center justify-center p-6 relative">
      {/* Background Decor */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl h-full max-h-[600px] border-[1px] border-white/5 pointer-events-none"></div>
      
      <div className="relative z-10 w-full flex flex-col items-center">
        <div className="mb-12 text-center">
          <div className="bg-acid text-black font-mono text-[10px] px-3 py-1 font-bold uppercase tracking-[0.3em] inline-block mb-4">
            Security Gate
          </div>
          <h1 className="font-anton text-7xl md:text-9xl text-white uppercase tracking-tighter leading-none">
            Authentication
          </h1>
          <p className="font-mono text-xs text-white/40 mt-4 uppercase tracking-[0.2em] max-w-md mx-auto">
            Authorized access only. Verification required for archive entry.
          </p>
        </div>

        <AuthForm />

        <div className="mt-12 font-mono text-[8px] text-gray-600 uppercase tracking-[0.5em] flex gap-8">
          <span>Encrypted Session</span>
          <span>End-to-end Logic</span>
          <span>Archive v1.0</span>
        </div>
      </div>
    </div>
  );
}
