import { useCallback, useState } from 'react';
import { AuthUser } from '../../types/auth';
import { ServiceOrderForm } from './ServiceOrderForm';
import { ServiceOrderToasts, ServiceOrderToast } from './ServiceOrderToasts';
import { ServiceOrdersDashboard } from './ServiceOrdersDashboard';
import { ServiceOrder, ServiceOrderToastType } from './types';
import './ServiceOrders.css';

interface ServiceOrdersPanelProps {
  currentUser: AuthUser;
}

export function ServiceOrdersPanel({ currentUser }: ServiceOrdersPanelProps) {
  const [screen, setScreen] = useState<'dashboard' | 'form'>('dashboard');
  const [selectedOrder, setSelectedOrder] = useState<ServiceOrder | null>(null);
  const [toasts, setToasts] = useState<ServiceOrderToast[]>([]);

  const notify = useCallback((message: string, type: ServiceOrderToastType) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(previous => [...previous, { id, message, type }]);
    window.setTimeout(() => setToasts(previous => previous.filter(toast => toast.id !== id)), 5_000);
  }, []);

  const openNew = () => {
    setSelectedOrder(null);
    setScreen('form');
  };

  const openOrder = (order: ServiceOrder) => {
    setSelectedOrder(order);
    setScreen('form');
  };

  return (
    <div className="service-orders-shell">
      {screen === 'dashboard' ? (
        <ServiceOrdersDashboard
          currentUser={currentUser}
          onOpenOrder={openOrder}
          onNewOrder={openNew}
          notify={notify}
        />
      ) : (
        <ServiceOrderForm
          key={selectedOrder?.id || `new-${currentUser.id}`}
          currentUser={currentUser}
          initialOrder={selectedOrder}
          onBack={() => { setSelectedOrder(null); setScreen('dashboard'); }}
          notify={notify}
        />
      )}
      <ServiceOrderToasts toasts={toasts} onDismiss={id => setToasts(previous => previous.filter(toast => toast.id !== id))} />
    </div>
  );
}
