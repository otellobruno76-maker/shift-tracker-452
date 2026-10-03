import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import BottomNav from "@/components/BottomNav";
import { hydrateAndSeed, useAppReady } from "@/lib/store";
import Calendario from "@/pages/Calendario";
import ConfiguraCedolino from "@/pages/ConfiguraCedolino";
import Cedolini from "@/pages/Cedolini";
import Impostazioni from "@/pages/Impostazioni";
import InserisciGiornata from "@/pages/InserisciGiornata";
import Oggi from "@/pages/Oggi";
import Riepilogo from "@/pages/Riepilogo";

export default function App() {
  const [storageError, setStorageError] = useState(false);
  const appReady = useAppReady();
  useEffect(() => {
    void hydrateAndSeed().catch(() => setStorageError(true));
  }, []);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [pathname]);
  const formMode = pathname.startsWith("/inserisci") || pathname.startsWith("/configura-cedolino") || pathname.startsWith("/cedolini");

  return (
    <div className="min-h-svh bg-[#F4F5F8] text-[#0F172A]">
      <div className={`mx-auto w-full max-w-md px-4 ${formMode ? "pb-44" : "pb-28"} pt-4`}>
        {storageError ? <p role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">Impossibile leggere i dati salvati su questo dispositivo. Ricarica la pagina e riprova.</p> : !appReady ? <p role="status">Caricamento dati locali…</p> : <Routes>
          <Route path="/" element={<Oggi />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/riepilogo" element={<Riepilogo />} />
          <Route path="/impostazioni" element={<Impostazioni />} />
          <Route path="/inserisci" element={<InserisciGiornata />} />
          <Route path="/configura-cedolino" element={<ConfiguraCedolino />} />
          <Route path="/cedolini" element={<Cedolini />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>}
      </div>
      {!formMode && !storageError && appReady && <BottomNav />}
      <Toaster position="bottom-right" offset={88} />
    </div>
  );
}
