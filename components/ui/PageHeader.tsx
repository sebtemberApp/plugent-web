/** A page's large title and its one-line purpose. */
export function PageHeader({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] min-[600px]:text-[34px] min-[600px]:leading-[40px]">
        {title}
      </h1>
      {lead && <p className="text-[17px] leading-[26px] text-ink2">{lead}</p>}
    </div>
  );
}
