function Card({ className = "", ...props }) {
  return <section className={className} {...props} />
}

function CardContent({ className = "", ...props }) {
  return <div className={className} {...props} />
}

function CardHeader({ className = "", ...props }) {
  return <header className={className} {...props} />
}

function CardTitle({ className = "", ...props }) {
  return <h2 className={className} {...props} />
}

export { Card, CardContent, CardHeader, CardTitle }
