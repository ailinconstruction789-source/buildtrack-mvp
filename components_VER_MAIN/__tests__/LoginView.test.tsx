import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginView from '../LoginView';

describe('LoginView Component', () => {
  const mockAllUsers = [
    { id: 1, username: 'admin', role: 'Admin' },
    { id: 2, username: 'user1', role: 'User' }
  ];

  const defaultProps = {
    dialogConfig: { isOpen: false, title: '', message: '' },
    closeDialog: vi.fn(),
    loginData: { username: '', pin: '' },
    setLoginData: vi.fn(),
    allUsers: mockAllUsers,
    handleLogin: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form correctly', () => {
    render(<LoginView {...defaultProps} />);
    expect(screen.getByText('BuildTrack')).toBeInTheDocument();
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PIN Code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('populates user select with allUsers data', () => {
    render(<LoginView {...defaultProps} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3); // 1 default + 2 mock users
    expect(screen.getByText('admin (Admin)')).toBeInTheDocument();
    expect(screen.getByText('user1 (User)')).toBeInTheDocument();
  });

  it('calls setLoginData when username is changed', () => {
    render(<LoginView {...defaultProps} />);
    const select = screen.getByLabelText(/Username/i);
    fireEvent.change(select, { target: { value: 'admin' } });
    expect(defaultProps.setLoginData).toHaveBeenCalledWith({ username: 'admin', pin: '' });
  });

  it('calls setLoginData when PIN is changed', () => {
    render(<LoginView {...defaultProps} />);
    const input = screen.getByLabelText(/PIN Code/i);
    fireEvent.change(input, { target: { value: '1234' } });
    expect(defaultProps.setLoginData).toHaveBeenCalledWith({ username: '', pin: '1234' });
  });

  it('filters non-numeric characters from PIN', () => {
    render(<LoginView {...defaultProps} />);
    const input = screen.getByLabelText(/PIN Code/i);
    fireEvent.change(input, { target: { value: '12ab' } });
    expect(defaultProps.setLoginData).toHaveBeenCalledWith({ username: '', pin: '12' });
  });

  it('disables login button if username is empty or PIN length is not 4', () => {
    const props = { ...defaultProps, loginData: { username: 'admin', pin: '123' } };
    const { rerender } = render(<LoginView {...props} />);
    
    let button = screen.getByRole('button', { name: /Sign In/i });
    expect(button).toBeDisabled();

    rerender(<LoginView {...defaultProps} loginData={{ username: '', pin: '1234' }} />);
    button = screen.getByRole('button', { name: /Sign In/i });
    expect(button).toBeDisabled();

    rerender(<LoginView {...defaultProps} loginData={{ username: 'admin', pin: '1234' }} />);
    button = screen.getByRole('button', { name: /Sign In/i });
    expect(button).not.toBeDisabled();
  });

  it('calls handleLogin when button is clicked', () => {
    const props = { ...defaultProps, loginData: { username: 'admin', pin: '1234' } };
    render(<LoginView {...props} />);
    const button = screen.getByRole('button', { name: /Sign In/i });
    fireEvent.click(button);
    expect(props.handleLogin).toHaveBeenCalledTimes(1);
  });

  it('renders dialog when dialogConfig.isOpen is true', () => {
    const props = { 
      ...defaultProps, 
      dialogConfig: { isOpen: true, title: 'Error Title', message: 'Error Message' } 
    };
    render(<LoginView {...props} />);
    expect(screen.getByText('Error Title')).toBeInTheDocument();
    expect(screen.getByText('Error Message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /รับทราบ/i })).toBeInTheDocument();
  });

  it('calls closeDialog when dialog close button is clicked', () => {
    const props = { 
      ...defaultProps, 
      dialogConfig: { isOpen: true, title: 'Error Title', message: 'Error Message' } 
    };
    render(<LoginView {...props} />);
    const button = screen.getByRole('button', { name: /รับทราบ/i });
    fireEvent.click(button);
    expect(props.closeDialog).toHaveBeenCalledTimes(1);
  });
});
