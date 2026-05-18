'use client';

import { useEffect, useState } from 'react';
import { Bug, Plus, X, Send, CheckCircle, Clock, MessageSquare, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow, formatDate } from '@/lib/utils/date';
import type { BugReport, BugReportDetail } from '@/types';

export default function BugReportsPage() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [selected, setSelected] = useState<BugReportDetail | null>(null);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [commentText, setCommentText] = useState('');
  const [commenting, setCommenting] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    loadReports();
    checkAdmin();
  }, []);

  async function checkAdmin() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
    setIsAdmin(profile?.is_admin ?? false);
  }

  async function loadReports() {
    setLoading(true);
    try {
      const res = await fetch('/api/bug-reports');
      if (res.ok) {
        const { reports: data } = await res.json();
        setReports(data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectReport(report: BugReport) {
    setSelected({ ...report, comments: [] });
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bug-reports/${report.id}`);
      if (res.ok) {
        const { report: detail } = await res.json();
        setSelected(detail);
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() || !formDesc.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: formTitle, description: formDesc }),
      });
      if (res.ok) {
        setFormTitle('');
        setFormDesc('');
        setShowForm(false);
        setTab('open');
        await loadReports();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || !selected || commenting) return;
    setCommenting(true);
    try {
      const res = await fetch(`/api/bug-reports/${selected.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: commentText }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setCommentText('');
        setSelected((prev) => prev ? { ...prev, comments: [...prev.comments, comment] } : prev);
        setReports((prev) =>
          prev.map((r) => r.id === selected.id ? { ...r, comment_count: (r.comment_count ?? 0) + 1 } : r)
        );
      }
    } finally {
      setCommenting(false);
    }
  }

  async function handleResolve() {
    if (!selected || resolving) return;
    const newStatus = selected.status === 'open' ? 'resolved' : 'open';
    setResolving(true);
    try {
      const res = await fetch(`/api/bug-reports/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setSelected((prev) => prev ? {
          ...prev,
          status: newStatus,
          resolved_at: newStatus === 'resolved' ? now : null,
        } : prev);
        setReports((prev) =>
          prev.map((r) => r.id === selected.id ? { ...r, status: newStatus } : r)
        );
      }
    } finally {
      setResolving(false);
    }
  }

  const filtered = reports.filter((r) => r.status === tab);
  const openCount = reports.filter((r) => r.status === 'open').length;
  const resolvedCount = reports.filter((r) => r.status === 'resolved').length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-8 py-5 shrink-0"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-3">
          <Bug size={22} style={{ color: 'var(--color-accent)' }} />
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>
              Bug Reports
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
              {isAdmin ? 'Manage and respond to user-reported bugs' : 'Submit and track your bug reports'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-accent)', color: '#fff' }}
        >
          <Plus size={15} />
          New Report
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* List panel */}
        <div
          className="flex flex-col shrink-0 overflow-hidden"
          style={{ width: 320, borderRight: 'var(--border-default)' }}
        >
          {/* Tabs */}
          <div className="flex gap-1 p-3 shrink-0" style={{ borderBottom: 'var(--border-default)' }}>
            {(['open', 'resolved'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: tab === t ? 'var(--color-bg-elevated)' : 'transparent',
                  color: tab === t ? 'var(--color-white)' : 'var(--color-white-muted)',
                  border: tab === t ? 'var(--border-default)' : '1px solid transparent',
                }}
              >
                {t === 'open' ? <Clock size={11} /> : <CheckCircle size={11} />}
                {t === 'open' ? `Open (${openCount})` : `Resolved (${resolvedCount})`}
              </button>
            ))}
          </div>

          {/* Report list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 gap-2" style={{ color: 'var(--color-white-muted)' }}>
                <RefreshCw size={16} className="animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-2 px-6 text-center">
                <Bug size={28} style={{ color: 'var(--color-white-muted)', opacity: 0.3 }} />
                <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
                  {tab === 'open' ? 'No open reports' : 'No resolved reports yet'}
                </p>
              </div>
            ) : (
              filtered.map((report) => (
                <button
                  key={report.id}
                  onClick={() => selectReport(report)}
                  className="w-full text-left px-4 py-3 transition-colors"
                  style={{
                    background: selected?.id === report.id ? 'var(--color-bg-elevated)' : 'transparent',
                    borderBottom: 'var(--border-default)',
                    borderLeft: selected?.id === report.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                  }}
                >
                  <p
                    className="text-sm font-medium leading-snug mb-1 truncate"
                    style={{ color: 'var(--color-white)' }}
                  >
                    {report.title}
                  </p>
                  <p
                    className="text-xs mb-2 overflow-hidden"
                    style={{
                      color: 'var(--color-white-muted)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {report.description}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs" style={{ color: 'var(--color-white-muted)', opacity: 0.6 }}>
                      @{report.author_username}
                    </span>
                    <span style={{ color: 'var(--color-white-muted)', opacity: 0.3 }}>·</span>
                    <span className="text-xs" style={{ color: 'var(--color-white-muted)', opacity: 0.6 }}>
                      {formatDistanceToNow(report.created_at)}
                    </span>
                    {(report.comment_count ?? 0) > 0 && (
                      <>
                        <span style={{ color: 'var(--color-white-muted)', opacity: 0.3 }}>·</span>
                        <span
                          className="flex items-center gap-0.5 text-xs"
                          style={{ color: 'var(--color-white-muted)', opacity: 0.6 }}
                        >
                          <MessageSquare size={10} />
                          {report.comment_count}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Bug size={40} style={{ color: 'var(--color-white-muted)', opacity: 0.15 }} />
              <p className="text-sm" style={{ color: 'var(--color-white-muted)', opacity: 0.4 }}>
                Select a report to view details
              </p>
            </div>
          ) : (
            <div className="p-8 max-w-2xl">
              {/* Report header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                      style={
                        selected.status === 'open'
                          ? { background: 'rgba(59,158,255,0.15)', color: 'var(--color-accent)' }
                          : { background: 'rgba(52,211,153,0.15)', color: '#34d399' }
                      }
                    >
                      {selected.status === 'open' ? <Clock size={10} /> : <CheckCircle size={10} />}
                      {selected.status === 'open' ? 'Open' : 'Resolved'}
                    </span>
                    {selected.resolved_at && (
                      <span className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                        Resolved {formatDistanceToNow(selected.resolved_at)}
                      </span>
                    )}
                  </div>
                  <h2
                    className="text-lg font-semibold mb-1.5 leading-snug"
                    style={{ color: 'var(--color-white)' }}
                  >
                    {selected.title}
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>
                    Submitted by{' '}
                    <strong style={{ color: 'var(--color-white)' }}>@{selected.author_username}</strong>
                    {' '}·{' '}
                    {formatDate(selected.created_at)}
                  </p>
                </div>

                {isAdmin && (
                  <button
                    onClick={handleResolve}
                    disabled={resolving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 transition-opacity disabled:opacity-40"
                    style={
                      selected.status === 'open'
                        ? { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }
                        : { background: 'rgba(59,158,255,0.1)', color: 'var(--color-accent)', border: '1px solid rgba(59,158,255,0.25)' }
                    }
                  >
                    {resolving
                      ? <RefreshCw size={11} className="animate-spin" />
                      : selected.status === 'open'
                        ? <CheckCircle size={11} />
                        : <Clock size={11} />
                    }
                    {selected.status === 'open' ? 'Mark Resolved' : 'Reopen'}
                  </button>
                )}
              </div>

              {/* Description */}
              <div
                className="p-4 rounded-xl mb-8"
                style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-white)' }}>
                  {selected.description}
                </p>
              </div>

              {/* Comments section */}
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-4"
                  style={{ color: 'var(--color-white-muted)' }}
                >
                  Comments{selected.comments.length > 0 ? ` (${selected.comments.length})` : ''}
                </p>

                {detailLoading ? (
                  <div className="flex items-center gap-2 mb-4" style={{ color: 'var(--color-white-muted)' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    <span className="text-sm">Loading comments…</span>
                  </div>
                ) : selected.comments.length === 0 ? (
                  <p className="text-sm mb-6" style={{ color: 'var(--color-white-muted)', opacity: 0.5 }}>
                    No comments yet.
                  </p>
                ) : (
                  <div className="space-y-3 mb-6">
                    {selected.comments.map((comment) => (
                      <div
                        key={comment.id}
                        className="p-4 rounded-xl"
                        style={{ background: 'var(--color-bg-elevated)', border: 'var(--border-default)' }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: 'var(--color-accent)' }}
                          >
                            @{comment.author_username}
                          </span>
                          <span className="text-xs" style={{ color: 'var(--color-white-muted)', opacity: 0.5 }}>
                            {formatDistanceToNow(comment.created_at)}
                          </span>
                        </div>
                        <p
                          className="text-sm leading-relaxed whitespace-pre-wrap"
                          style={{ color: 'var(--color-white)' }}
                        >
                          {comment.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Comment input — admin only */}
                {isAdmin && (
                  <form onSubmit={handleComment} className="flex gap-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment…"
                      className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        background: 'var(--color-bg-elevated)',
                        border: 'var(--border-default)',
                        color: 'var(--color-white)',
                      }}
                    />
                    <button
                      type="submit"
                      disabled={!commentText.trim() || commenting}
                      className="flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
                      style={{ background: 'var(--color-accent)', color: '#fff', minWidth: 40 }}
                    >
                      {commenting
                        ? <RefreshCw size={14} className="animate-spin" />
                        : <Send size={14} />
                      }
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Report modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setShowForm(false)}
        >
          <div
            className="relative rounded-xl overflow-hidden"
            style={{
              width: 500,
              background: 'var(--color-bg-elevated)',
              border: 'var(--border-default)',
              boxShadow: 'var(--shadow-modal)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: 'var(--border-default)' }}
            >
              <div className="flex items-center gap-2">
                <Bug size={15} style={{ color: 'var(--color-accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>
                  New Bug Report
                </span>
              </div>
              <button onClick={() => setShowForm(false)} className="p-0.5 rounded hover:opacity-60">
                <X size={14} style={{ color: 'var(--color-white-muted)' }} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--color-white-muted)' }}
                >
                  Title
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Brief summary of the issue"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{
                    background: 'var(--color-bg-surface)',
                    border: 'var(--border-default)',
                    color: 'var(--color-white)',
                  }}
                  maxLength={120}
                  required
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--color-white-muted)' }}
                >
                  Description
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Describe what happened, steps to reproduce, and what you expected to see…"
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
                  style={{
                    background: 'var(--color-bg-surface)',
                    border: 'var(--border-default)',
                    color: 'var(--color-white)',
                  }}
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80"
                  style={{
                    background: 'var(--color-bg-surface)',
                    color: 'var(--color-white-muted)',
                    border: 'var(--border-default)',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !formTitle.trim() || !formDesc.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--color-accent)', color: '#fff' }}
                >
                  {submitting && <RefreshCw size={13} className="animate-spin" />}
                  Submit Report
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
