export default function Footer() {
  return (
    <footer className="border-t border-[#ebebeb] py-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div style={{ width: 36, height: 23, overflow: "hidden", borderRadius: 7, flexShrink: 0 }}>
              <img src={`${import.meta.env.BASE_URL}icon.png`} alt="SWIMNOTE" style={{ width: 36, height: "auto", display: "block" }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            </div>
            <span className="text-[15px] font-bold tracking-tight text-[#0a0a0a]" translate="no">SWIMNOTE</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 text-[13px] text-[#aaa]">
            <a href="mailto:swimnote.admin@gmail.com" className="hover:text-[#555] transition-colors">
              swimnote.admin@gmail.com
            </a>
            <a href="tel:01077871507" className="hover:text-[#555] transition-colors">
              010-7787-1507
            </a>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-[#f5f5f5]">
          <p className="text-[12px] text-[#ccc]">
            &copy; {new Date().getFullYear()} SWIMNOTE. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
