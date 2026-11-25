import { redirect } from 'next/navigation';

export default function LegacyJamBoxPage() {
  redirect('/dashboard/audio');
}
