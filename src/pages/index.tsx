/**
 * Landing page — static (no providers), prerendered at build for crawlers.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'

const steps = [
  { title: 'Write a rubric, paste outputs', body: 'Two to four labels and up to 50 prompt/output pairs. Share one invite link.' },
  { title: 'Everyone rates blind', body: "You can't see a teammate's label for an item until you've submitted yours. The server enforces it, not just the UI." },
  { title: 'Watch agreement live', body: "Cohen's κ for every pair of raters updates as labels land, with the items where you split listed for discussion." },
  { title: 'Check the judge', body: 'Set gold labels on the splits, run an AI judge on the same rubric, and see if it agrees with you as well as you agree with each other.' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="mx-auto flex min-h-screen max-w-5xl flex-col px-6">
        <header className="flex h-16 items-center justify-between">
          <span className="font-semibold">LabelRoom</span>
          <Link to="/home" className="text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
        </header>

        <section className="py-20 sm:py-28">
          <p className="text-sm font-medium text-primary">For teams grading LLM outputs</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">One rater's labels hide disagreement.</h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            LabelRoom is a live room where your team labels the same outputs blind and sees, as you go, whether you actually
            agree. The answer is usually a decision: “our rubric is ambiguous on item 7.”
          </p>
          <div className="mt-10">
            <Link
              to="/home"
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Open a room
            </Link>
          </div>
        </section>

        <section className="grid gap-8 border-t border-border py-16 sm:grid-cols-2">
          {steps.map((s, i) => (
            <div key={s.title}>
              <p className="text-sm tabular-nums text-muted-foreground">0{i + 1}</p>
              <h2 className="mt-1 text-lg font-semibold">{s.title}</h2>
              <p className="mt-2 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </section>

        <footer className="mt-auto border-t border-border py-8 text-sm text-muted-foreground">Built on DeepSpace.</footer>
      </div>
    </>
  )
}
