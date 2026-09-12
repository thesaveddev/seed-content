import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CalendarPage from '../pages/CalendarPage';
import { scheduler, content as contentApi } from '../lib/api';
import toast from 'react-hot-toast';

vi.mock('../lib/api', () => ({
  scheduler: {
    list: vi.fn(), get: vi.fn(), create: vi.fn(), reschedule: vi.fn(),
    updateNotes: vi.fn(), cancel: vi.fn(), retry: vi.fn(), markPublished: vi.fn(), delete: vi.fn(),
  },
  content: { list: vi.fn(), get: vi.fn() },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const mockedScheduler = vi.mocked(scheduler, true);
const mockedContent = vi.mocked(contentApi, true);

// Fixtures are anchored to the current month so the page's month query finds them.
const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth();

function isoThisMonth(day: number, hour = 10, minute = 0) {
  return new Date(YEAR, MONTH, day, hour, minute, 0).toISOString();
}

function makePost(overrides: Record<string, any> = {}) {
  return {
    _id: 'post-1',
    workspaceId: 'w1',
    projectId: 'proj-1',
    generatedContentId: 'gc-1',
    platform: 'linkedin',
    scheduledAt: isoThisMonth(15, 10),
    status: 'scheduled',
    notes: '',
    createdAt: isoThisMonth(1, 9),
    ...overrides,
  };
}

function renderCalendar() {
  return render(
    <MemoryRouter>
      <CalendarPage />
    </MemoryRouter>
  );
}

async function openDetailFor(timeLabel: string) {
  const user = userEvent.setup();
  // Clicking the time chip bubbles to the chip's onClick → opens the slide-over
  await user.click(await screen.findByText(timeLabel));
  await screen.findByText('Scheduled Post');
  return user;
}

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedScheduler.list.mockResolvedValue({ success: true, data: [] } as any);
    mockedContent.list.mockResolvedValue({ success: true, data: [] } as any);
  });

  it('renders the header, month navigation and the schedule button', async () => {
    renderCalendar();

    expect(screen.getByRole('heading', { name: /content calendar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /schedule post/i })).toBeInTheDocument();
    // Month name for the current month is shown
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: new RegExp(new Date(YEAR, MONTH).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), 'i'),
      })
    ).toBeInTheDocument();
  });

  it('shows the empty state when nothing is scheduled', async () => {
    renderCalendar();

    expect(await screen.findByText(/no posts scheduled/i)).toBeInTheDocument();
    expect(screen.getByText(/0 posts this month/i)).toBeInTheDocument();
  });

  it('renders scheduled posts for the current month', async () => {
    mockedScheduler.list.mockResolvedValue({ success: true, data: [makePost()] } as any);
    renderCalendar();

    expect(await screen.findByText(/1 post this month/i)).toBeInTheDocument();
    // The post chip shows its local time
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
  });

  it('opens the detail panel with actions for a scheduled post', async () => {
    mockedScheduler.list.mockResolvedValue({ success: true, data: [makePost()] } as any);
    renderCalendar();

    await openDetailFor('10:00 AM');

    // Platform name is title-cased in the panel, and status is lowercase
    expect(screen.getAllByText('Linkedin').length).toBeGreaterThan(0);
    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark as published/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel schedule/i })).toBeInTheDocument();
  });

  it('marks a scheduled post as published and refreshes the list', async () => {
    mockedScheduler.list.mockResolvedValue({ success: true, data: [makePost()] } as any);
    mockedScheduler.markPublished.mockResolvedValue({ success: true } as any);
    renderCalendar();

    const user = await openDetailFor('10:00 AM');
    await user.click(screen.getByRole('button', { name: /mark as published/i }));

    await waitFor(() => expect(mockedScheduler.markPublished).toHaveBeenCalledWith('post-1'));
    // Initial load + refresh after the action
    expect(mockedScheduler.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cancels a scheduled post', async () => {
    mockedScheduler.list.mockResolvedValue({ success: true, data: [makePost()] } as any);
    mockedScheduler.cancel.mockResolvedValue({ success: true } as any);
    renderCalendar();

    const user = await openDetailFor('10:00 AM');
    await user.click(screen.getByRole('button', { name: /cancel schedule/i }));

    await waitFor(() => expect(mockedScheduler.cancel).toHaveBeenCalledWith('post-1'));
  });

  it('offers a retry action for a failed post and calls the retry API', async () => {
    mockedScheduler.list.mockResolvedValue({
      success: true,
      data: [makePost({ status: 'failed', errorMessage: 'Telegram rejected the post: Chat not found' })],
    } as any);
    mockedScheduler.retry.mockResolvedValue({ success: true } as any);
    renderCalendar();

    const user = await openDetailFor('10:00 AM');

    expect(screen.getByRole('button', { name: /retry publish/i })).toBeInTheDocument();
    expect(screen.getByText(/Telegram rejected the post: Chat not found/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry publish/i }));

    await waitFor(() => expect(mockedScheduler.retry).toHaveBeenCalledWith('post-1'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('passes the selected platform filter through to the scheduler list query', async () => {
    renderCalendar();
    await screen.findByText(/no posts scheduled/i);

    const [platformSelect] = screen.getAllByRole('combobox');
    await userEvent.setup().selectOptions(platformSelect, 'instagram');

    await waitFor(() => {
      expect(
        mockedScheduler.list.mock.calls.some(([params]: any) => params?.platform === 'instagram')
      ).toBe(true);
    });
  });

  it('guides the user when there is no ready content to schedule', async () => {
    mockedContent.list.mockResolvedValue({ success: true, data: [] } as any);
    renderCalendar();

    await userEvent.setup().click(screen.getByRole('button', { name: /schedule post/i }));

    expect(await screen.findByText(/schedule a post/i)).toBeInTheDocument();
    expect(await screen.findByText(/don't have any ready content yet/i)).toBeInTheDocument();
  });

  it('creates a scheduled post from a ready content pack', async () => {
    const user = userEvent.setup();
    mockedContent.list.mockResolvedValue({
      success: true,
      data: [{ _id: 'proj-1', title: 'My Pack', status: 'ready' }],
      total: 1, page: 1, pages: 1,
    } as any);
    mockedContent.get.mockResolvedValue({
      success: true,
      data: { generatedContent: [{ _id: 'gc-1', platform: 'linkedin', type: 'post' }] },
    } as any);
    mockedScheduler.create.mockResolvedValue({ success: true } as any);

    renderCalendar();
    await screen.findByText(/no posts scheduled/i);

    await user.click(screen.getByRole('button', { name: /schedule post/i }));
    await screen.findByText(/schedule a post/i);
    await screen.findByText('My Pack'); // project option loaded

    // Filters are the first two comboboxes; the modal's selects follow.
    let combos = screen.getAllByRole('combobox');
    const contentSelect = combos[2];
    await user.selectOptions(contentSelect, 'proj-1');

    // Piece select appears once the project's pieces load
    await screen.findByText(/linkedin — post/i);
    combos = screen.getAllByRole('combobox');
    await user.selectOptions(combos[3], 'gc-1');

    await user.click(screen.getByRole('button', { name: /^schedule$/i }));

    await waitFor(() => {
      expect(mockedScheduler.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          generatedContentId: 'gc-1',
          platform: 'linkedin',
        })
      );
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
