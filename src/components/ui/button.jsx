function Button({ className = "", variant = "default", size, ...props }) {
  const variantClass = variant === "outline"
    ? "border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-800"
    : "bg-slate-800 text-slate-100 hover:bg-slate-700"
  const sizeClass = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${sizeClass} ${className}`}
      {...props}
    />
  )
}

export { Button }
