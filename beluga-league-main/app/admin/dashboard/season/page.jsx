import { redirect } from 'next/navigation'

export default function LegacySeasonRedirect() {
  redirect('/admin/dashboard/seasons')
}
