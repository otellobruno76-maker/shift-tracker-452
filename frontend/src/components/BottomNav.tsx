import { NavLink } from "react-router-dom";
import { BarChart3, CalendarDays, Clock, Settings2 } from "lucide-react";

const TABS = [
  { to: "/", label: "Oggi", icon: Clock, testid: "nav-tab-oggi" },
  { to: "/calendario", label: "Calendario", icon: CalendarDays, testid: "nav-tab-calendario" },
  { to: "/riepilogo", label: "Riepilogo", icon: BarChart3, testid: "nav-tab-riepilogo" },
  { to: "/impostazioni", label: "Impostazioni", icon: Settings2, testid: "nav-tab-impostazioni" },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#E2E5EA] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      data-testid="bottom-nav"
    >
      <div className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ to, label, icon: Icon, testid }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            data-testid={testid}
            className={({ isActive }) =>
              `flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors duration-150 ${
                isActive
                  ? "bg-[#EFF6FF] font-bold text-[#0284C7]"
                  : "font-medium text-[#64748B] active:bg-[#F4F5F8]"
              }`
            }
          >
            <Icon className="h-6 w-6" strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
