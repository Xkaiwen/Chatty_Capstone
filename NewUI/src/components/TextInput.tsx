"use client"
import React from 'react';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}

export default function TextInput({ value, onChange, placeholder }: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full p-2 mb-2 bg-black border border-gray-500 rounded"
    />
  );
}