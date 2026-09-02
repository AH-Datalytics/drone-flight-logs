export default function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return <div className="stats">{items.map(i => <div className="stat" key={i.label}><div className="v">{i.value}</div><div className="l">{i.label}</div></div>)}</div>;
}
