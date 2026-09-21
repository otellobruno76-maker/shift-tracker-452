import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import BottomNav from "@/components/BottomNav";
import { hydrateAndSeed } from "@/lib/store";
import Calendario from "@/pages/Calendario";
import ConfiguraCedolino from "@/pages/ConfiguraCedolino";
import Cedolini from "@/pages/Cedolini";
import Impostazioni from "@/pages/Impostazioni";
import InserisciGiornata from "@/pages/InserisciGiornata";
import Oggi from "@/pages/Oggi";
import Riepilogo from "@/pages/Riepilogo";

export default function App() {
  useEffect(() => {
    void hydrateAndSeed();
  }, []);
  const { pathname } = useLocation();
  const formMode = pathname.startsWith("/inserisci") || pathname.startsWith("/configura-cedolino") || pathname.startsWith("/cedolini");

  return (
    <div className="min-h-svh bg-[#F4F5F8] text-[#0F172A]">
      <div className={`mx-auto w-full max-w-md px-4 ${formMode ? "pb-44" : "pb-28"} pt-4`}>
        <Routes>
          <Route path="/" element={<Oggi />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/riepilogo" element={<Riepilogo />} />
          <Route path="/impostazioni" element={<Impostazioni />} />
          <Route path="/inserisci" element={<InserisciGiornata />} />
          <Route path="/configura-cedolino" element={<ConfiguraCedolino />} />
          <Route path="/cedolini" element={<Cedolini />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {!formMode && <BottomNav />}
      <Toaster position="bottom-right" offset={88} />
    </div>
  );
}
