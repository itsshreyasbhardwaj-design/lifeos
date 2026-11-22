'use client';

import { ApiForm, useToast } from './api';

export function EventForm({ date }: { date: string }) {
  const toast = useToast();
  return (
    <ApiForm path="/calendar/events" className="space-y-3"
      transform={(b) => ({
        ...b,
        allDay: Boolean(b.allDay),
        recurrence: b.repeat ? { freq: b.repeat, interval: 1 } : null,
        remindMinutesBefore: b.remind ? [Number(b.remind)] : [],
        bufferMinutes: b.bufferMinutes ?? 0,
        repeat: undefined,
        remind: undefined,
      })}
      onDone={(d) => {
        const c = (d as { conflicts: { title: string }[] }).conflicts;
        toast(c.length ? `Saved. It overlaps with: ${c.map((x) => x.title).join(', ')}` : 'Saved to your calendar.', c.length ? 'error' : 'ok');
      }}>
      <div><label className="label" htmlFor="ev-title">Title</label><input id="ev-title" name="title" required className="field" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ev-date">Date</label><input id="ev-date" name="date" type="date" defaultValue={date} required className="field" /></div>
        <div><label className="label" htmlFor="ev-kind">Kind</label><select id="ev-kind" name="kind" className="field"><option value="appointment">Appointment</option><option value="deadline">Hard deadline</option><option value="flexible">Flexible plan</option><option value="time_block">Time block</option></select></div>
        <div><label className="label" htmlFor="ev-start">Starts</label><input id="ev-start" name="startTime" type="time" className="field" /></div>
        <div><label className="label" htmlFor="ev-end">Ends</label><input id="ev-end" name="endTime" type="time" className="field" /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allDay" data-kind="bool" /> All day</label>
      <div><label className="label" htmlFor="ev-loc">Where</label><input id="ev-loc" name="location" className="field" /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label" htmlFor="ev-rep">Repeats</label><select id="ev-rep" name="repeat" className="field"><option value="">No</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
        <div><label className="label" htmlFor="ev-rem">Remind</label><select id="ev-rem" name="remind" className="field"><option value="">No</option><option value="15">15 min before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></div>
      </div>
      <div><label className="label" htmlFor="ev-buf">Buffer (minutes before/after)</label><input id="ev-buf" name="bufferMinutes" type="number" min={0} max={240} data-kind="int" className="field" placeholder="0" /></div>
      <button className="btn btn-primary w-full">Add to calendar</button>
    </ApiForm>
  );
}
