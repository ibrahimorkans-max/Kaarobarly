import { useLocalSearchParams } from 'expo-router';
import { PosTerminal } from '@/components/pos-terminal';

export default function PosTab() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  return <PosTerminal orderId={orderId || undefined} />;
}
