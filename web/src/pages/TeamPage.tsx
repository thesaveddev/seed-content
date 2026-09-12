import { useState, useEffect, useCallback } from 'react';
import {
  Users, UserPlus, Copy, Check, Trash2, Shield, Eye, Edit3,
  ChevronDown, X, ExternalLink, Mail
} from 'lucide-react';
import { team as teamApi } from '../lib/api';
import React from 'react';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

const ROLE_CONFIG: Record<string, { label: string; icon: any; color: string; desc: string }> = {
  owner: { label: 'Owner', icon: Shield, color: 'var(--color-accent)', desc: 'Full control. Can manage billing, delete workspace.' },
  admin: { label: 'Admin', icon: Edit3, color: 'oklch(55% 0.14 60)', desc: 'Can invite members, manage brand voices, and create content.' },
  member: { label: 'Member', icon: Users, color: 'oklch(55% 0.15 150)', desc: 'Can create and edit content. Cannot invite others.' },
  viewer: { label: 'Viewer', icon: Eye, color: 'var(--color-muted)', desc: 'Read-only access to content library.' },
};

export default function TeamPage() {
  const { user } = useAuthStore();
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        teamApi.members(),
        teamApi.invites().catch(() => ({ data: [] })),
      ]);
      setMembers(membersRes.data || []);
      setInvites(invitesRes.data || []);
    } catch {
      toast.error('Failed to load team data');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await teamApi.invite(inviteEmail.trim(), inviteRole);
      setInviteLink(res.data.inviteLink);
      setInvites((prev) => [...prev, {
        _id: res.data._id,
        email: res.data.email,
        role: res.data.role,
        expiresAt: res.data.expiresAt,
        createdAt: new Date().toISOString(),
        invitedBy: user?.name || 'You',
      }]);
      toast.success('Invite sent');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInvite = (token: string) => {
    const link = `${window.location.origin}/accept-invite?token=${token}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Invite link copied');
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      await teamApi.revokeInvite(id);
      setInvites((prev) => prev.filter((i) => i._id !== id));
      toast.success('Invite revoked');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleChangeRole = async (memberId: string, newRole: string) => {
    try {
      await teamApi.updateRole(memberId, newRole);
      setMembers((prev) => prev.map((m) => m._id === memberId ? { ...m, role: newRole } : m));
      setRoleDropdown(null);
      toast.success('Role updated');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRemoveMember = async (memberId: string, name: string) => {
    if (!confirm(`Remove ${name} from the workspace?`)) return;
    try {
      await teamApi.removeMember(memberId);
      setMembers((prev) => prev.filter((m) => m._id !== memberId));
      toast.success('Member removed');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const isOwner = members.find((m) => m.userId === user?.id)?.role === 'owner';
  const isAdmin = isOwner || members.find((m) => m.userId === user?.id)?.role === 'admin';

  return (
    <div style={{ color: 'var(--color-ink)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Users style={{ width: 24, height: 24, color: 'var(--color-accent)' }} />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Team
          </h1>
          <span style={{
            fontSize: '0.8125rem',
            color: 'var(--color-muted)',
            fontFamily: 'var(--font-body)',
          }}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        </div>
        {isAdmin && (
          <button
            onClick={() => { setShowInvite(true); setInviteLink(''); setInviteEmail(''); }}
            className="btn-primary text-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <UserPlus style={{ width: 16, height: 16 }} />
            Invite
          </button>
        )}
      </div>

      {/* Members list */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.8125rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-muted)',
          marginBottom: '1rem',
        }}>
          Members
        </h2>
        <div style={{ borderTop: '1px solid var(--color-rule)' }}>
          {members.map((member) => {
            const roleInfo = ROLE_CONFIG[member.role] || ROLE_CONFIG.member;
            const RoleIcon = roleInfo.icon;
            const isCurrentUser = member.userId === user?.id;

            return (
              <div
                key={member._id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.875rem 0',
                  borderBottom: '1px solid var(--color-rule)',
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--color-paper-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: 'var(--color-accent)',
                  flexShrink: 0,
                }}>
                  {member.user?.name?.charAt(0).toUpperCase() || '?'}
                </div>

                {/* Name + email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--color-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}>
                    {member.user?.name || 'Unknown'}
                    {isCurrentUser && (
                      <span style={{
                        fontSize: '0.6875rem',
                        color: 'var(--color-muted)',
                        fontWeight: 400,
                      }}>
                        (you)
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '0.8125rem',
                    color: 'var(--color-muted)',
                  }}>
                    {member.user?.email}
                  </div>
                </div>

                {/* Role badge / dropdown */}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => {
                      if (isOwner && !isCurrentUser && member.role !== 'owner') {
                        setRoleDropdown(roleDropdown === member._id ? null : member._id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      padding: '0.25rem 0.625rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: roleInfo.color,
                      background: `${roleInfo.color}12`,
                      border: `1px solid ${roleInfo.color}25`,
                      cursor: isOwner && !isCurrentUser && member.role !== 'owner' ? 'pointer' : 'default',
                      fontFamily: 'var(--font-display)',
                      textTransform: 'capitalize',
                    }}
                  >
                    <RoleIcon style={{ width: 12, height: 12 }} />
                    {roleInfo.label}
                    {isOwner && !isCurrentUser && member.role !== 'owner' && (
                      <ChevronDown style={{ width: 10, height: 10 }} />
                    )}
                  </button>

                  {roleDropdown === member._id && (
                    <>
                      <div
                        style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                        onClick={() => setRoleDropdown(null)}
                      />
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '0.25rem',
                        background: 'var(--color-paper)',
                        border: '1px solid var(--color-rule)',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px oklch(18% 0.014 270 / 0.1)',
                        zIndex: 20,
                        minWidth: 180,
                        padding: '0.25rem',
                      }}>
                        {['admin', 'member', 'viewer'].map((role) => (
                          <button
                            key={role}
                            onClick={() => handleChangeRole(member._id, role)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              width: '100%',
                              padding: '0.5rem 0.625rem',
                              borderRadius: '6px',
                              fontSize: '0.8125rem',
                              color: member.role === role ? 'var(--color-accent)' : 'var(--color-ink)',
                              background: member.role === role ? 'var(--color-accent)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              textAlign: 'left',
                              fontFamily: 'var(--font-body)',
                              fontWeight: member.role === role ? 600 : 400,
                            }}
                            onMouseEnter={(e) => { if (member.role !== role) (e.currentTarget as HTMLElement).style.background = 'var(--color-paper-2)'; }}
                            onMouseLeave={(e) => { if (member.role !== role) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            {React.createElement(ROLE_CONFIG[role].icon, { style: { width: 14, height: 14 } })}
                            {ROLE_CONFIG[role].label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Actions */}
                {isOwner && !isCurrentUser && member.role !== 'owner' && (
                  <button
                    onClick={() => handleRemoveMember(member._id, member.user?.name || 'this member')}
                    style={{
                      padding: '0.25rem',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-muted)',
                      transition: 'color 0.15s ease',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'oklch(50% 0.16 25)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-muted)'; }}
                    title="Remove member"
                  >
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div style={{ marginBottom: '2.5rem' }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.8125rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-muted)',
            marginBottom: '1rem',
          }}>
            Pending invites
          </h2>
          <div style={{ borderTop: '1px solid var(--color-rule)' }}>
            {invites.map((inv) => (
              <div
                key={inv._id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  padding: '0.875rem 0',
                  borderBottom: '1px solid var(--color-rule)',
                }}
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'var(--color-paper-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-muted)',
                  flexShrink: 0,
                }}>
                  <Mail style={{ width: 16, height: 16 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.9375rem', fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                    {inv.email}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    Invited by {inv.invitedBy} · Expires {new Date(inv.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <span style={{
                  padding: '0.125rem 0.5rem',
                  borderRadius: '10px',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  color: ROLE_CONFIG[inv.role]?.color || 'var(--color-muted)',
                  background: `${ROLE_CONFIG[inv.role]?.color || 'var(--color-muted)'}12`,
                }}>
                  {inv.role}
                </span>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      onClick={() => handleCopyInvite(inv._id)}
                      style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
                      title="Copy invite link"
                    >
                      {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
                    </button>
                    <button
                      onClick={() => handleRevokeInvite(inv._id)}
                      style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
                      title="Revoke invite"
                    >
                      <X style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role descriptions */}
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.8125rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-muted)',
          marginBottom: '1rem',
        }}>
          Roles
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: '0.75rem',
        }}>
          {Object.entries(ROLE_CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <div
                key={key}
                style={{
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--color-rule)',
                  background: 'var(--color-paper)',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.375rem',
                }}>
                  <Icon style={{ width: 16, height: 16, color: config.color }} />
                  <span style={{
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    fontFamily: 'var(--font-display)',
                    color: 'var(--color-ink)',
                  }}>
                    {config.label}
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
                  {config.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shared brand voices note */}
      <div style={{
        padding: '1rem',
        borderRadius: '8px',
        border: '1px solid var(--color-rule)',
        background: 'var(--color-paper)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.375rem',
        }}>
          <span style={{ fontSize: '1rem' }}>🎙️</span>
          <span style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            fontFamily: 'var(--font-display)',
          }}>
            Shared brand voices
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
          Brand voices are shared across the entire workspace. All team members can use any brand voice when creating content.
          Manage them in <a href="/brand-voice" style={{ color: 'var(--color-accent)', textDecoration: 'underline' }}>Brand Voice</a>.
        </p>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'oklch(18% 0.014 270 / 0.4)',
          }}
        >
          <div style={{
            width: '100%',
            maxWidth: 420,
            background: 'var(--color-paper)',
            borderRadius: '12px',
            border: '1px solid var(--color-rule)',
            boxShadow: '0 8px 32px oklch(18% 0.014 270 / 0.12)',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.125rem', fontWeight: 700 }}>
                Invite teammate
              </h3>
              <button
                onClick={() => setShowInvite(false)}
                style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)' }}
              >
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>

            {inviteLink ? (
              <div>
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
                  Share this link with your teammate:
                </p>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--color-rule)',
                  background: 'var(--color-paper-2)',
                  marginBottom: '1rem',
                }}>
                  <span style={{
                    flex: 1,
                    fontSize: '0.8125rem',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--color-ink)',
                  }}>
                    {window.location.origin}{inviteLink}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}${inviteLink}`);
                      toast.success('Copied!');
                    }}
                    style={{ padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)' }}
                  >
                    <Copy style={{ width: 14, height: 14 }} />
                  </button>
                </div>
                <button
                  onClick={() => { setShowInvite(false); setInviteLink(''); }}
                  className="btn-primary w-full text-sm"
                >
                  Done
                </button>
              </div>
            ) : (
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-muted)',
                  marginBottom: '0.375rem',
                }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--color-rule)',
                    background: 'var(--color-paper)',
                    color: 'var(--color-ink)',
                    fontSize: '0.9375rem',
                    fontFamily: 'var(--font-body)',
                    marginBottom: '0.75rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />

                <label style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--color-muted)',
                  marginBottom: '0.375rem',
                }}>
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--color-rule)',
                    background: 'var(--color-paper)',
                    color: 'var(--color-ink)',
                    fontSize: '0.875rem',
                    fontFamily: 'var(--font-body)',
                    marginBottom: '1.25rem',
                    outline: 'none',
                  }}
                >
                  <option value="member">Member — create and edit content</option>
                  <option value="admin">Admin — invite others, manage voices</option>
                  <option value="viewer">Viewer — read-only access</option>
                </select>

                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="btn-primary w-full text-sm"
                  style={{ opacity: inviting || !inviteEmail.trim() ? 0.5 : 1 }}
                >
                  {inviting ? 'Sending invite...' : 'Send invite'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && members.length <= 1 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem 2rem',
          borderTop: '1px solid var(--color-rule)',
          marginTop: '1.5rem',
        }}>
          <Users style={{ width: 36, height: 36, color: 'var(--color-muted)', margin: '0 auto 1rem' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            You're the only member
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', maxWidth: 360, margin: '0 auto' }}>
            {isAdmin
              ? 'Invite teammates to collaborate on content together.'
              : 'Ask the workspace owner to invite teammates.'}
          </p>
        </div>
      )}
    </div>
  );
}
