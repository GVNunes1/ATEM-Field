export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="Carregando dados da operação">
      <span className="sr-only">Carregando agenda, equipe e patrimônios.</span>
      <div className="skeleton-heading" aria-hidden="true" />
      <div className="skeleton-description" aria-hidden="true" />
      <div className="skeleton-metrics" aria-hidden="true">{[0, 1, 2, 3].map(item => <div key={item} />)}</div>
      <div className="skeleton-content" aria-hidden="true">{[0, 1, 2, 3].map(item => <div key={item} />)}</div>
    </div>
  );
}
