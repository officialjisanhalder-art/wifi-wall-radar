# Real-Time WiFi CSI (Channel State Information) Visualizer
# Author: Jisan Halder
# 
# Note: This script parses standard binary CSI packets captured from 
# Intel 5300 / Atheros network adapters using custom Linux kernel drivers.
# It applies a Butterworth Filter and plots the subcarrier amplitudes in real-time.

import os
import struct
import numpy as np
import matplotlib.pyplot as plt
from scipy.signal import butter, lfilter

# 1. Butterworth filter to remove high-frequency environmental noise (e.g. appliances)
def butter_lowpass_filter(data, cutoff, fs, order=5):
    nyq = 0.5 * fs
    normal_cutoff = cutoff / nyq
    b, a = butter(order, normal_cutoff, btype='low', analog=False)
    y = lfilter(b, a, data)
    return y

# 2. Parse raw CSI binary logs (Intel 5300 format)
# Intel 5300 reports 30 subcarrier groups containing complex numbers (I + jQ)
def read_csi_packet(file_handle):
    # Packet header format: field sizes in bytes
    # [field_len (2) | code (1) | csi_len (2) | channel (2) | err_info (1) | noise (1) | rate (2) ...]
    header_data = file_handle.read(16)
    if len(header_data) < 16:
        return None
        
    field_len, code, csi_len = struct.unpack(">HBH", header_data[:5])
    
    if code != 187: # 187 is the standard Intel CSI code
        file_handle.seek(field_len - 14, 1) # Skip non-CSI packets
        return None
        
    csi_data = file_handle.read(csi_len)
    if len(csi_data) < csi_len:
        return None
        
    # Reconstruct the 30 subcarrier complex matrix (3 Tx antennas x 3 Rx antennas)
    # Extracting IQ channels (In-phase and Quadrature components)
    csi_matrix = np.zeros((3, 3, 30), dtype=complex)
    idx = 0
    for subcarrier in range(30):
        for rx in range(3):
            for tx in range(3):
                if idx + 1 >= len(csi_data):
                    break
                # Real (I) and Imaginary (Q) components are packed as signed bytes
                real = struct.unpack("b", bytes([csi_data[idx]]))[0]
                imag = struct.unpack("b", bytes([csi_data[idx+1]]))[0]
                csi_matrix[tx, rx, subcarrier] = complex(real, imag)
                idx += 2
                
    return csi_matrix

# 3. Real-time plotting function
def run_realtime_plot(filepath):
    if not os.path.exists(filepath):
        print(f"Error: Target CSI data stream file '{filepath}' not found.")
        print("To run real-time sensing, connect a compatible Intel 5300 / Atheros card.")
        return

    plt.ion() # Enable Matplotlib interactive mode
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.set_title("Real-Time WiFi CSI Subcarriers Amplitude Stream")
    ax.set_xlabel("Time Frames")
    ax.set_ylabel("Amplitude (dB)")
    
    # 30 lines (one for each OFDM subcarrier)
    lines = [ax.plot([], [], lw=1)[0] for _ in range(30)]
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 40)
    
    data_buffer = np.zeros((30, 100))
    frame_count = 0

    with open(filepath, "rb") as f:
        while True:
            matrix = read_csi_packet(f)
            if matrix is None:
                plt.pause(0.01) # Wait for new packet write
                continue
                
            # Extract amplitude from Tx1 -> Rx1 path for all 30 subcarriers
            # Amplitude = absolute value of the complex number: sqrt(I^2 + Q^2)
            amplitudes = np.abs(matrix[0, 0, :])
            
            # Shift buffer left and add new reading
            data_buffer = np.roll(data_buffer, -1, axis=1)
            data_buffer[:, -1] = amplitudes
            
            # Apply low-pass filter to smooth signal and isolate body movements
            if frame_count > 10:
                for s in range(30):
                    data_buffer[s, :] = butter_lowpass_filter(data_buffer[s, :], cutoff=3.0, fs=20.0, order=3)
            
            # Update lines data
            for s in range(30):
                lines[s].set_data(np.arange(100), data_buffer[s, :])
                
            fig.canvas.draw()
            fig.canvas.flush_events()
            frame_count += 1

if __name__ == "__main__":
    # In a real environment, this points to the live device stream node: e.g. "/dev/csi_data"
    run_realtime_plot("sample_csi_stream.dat")
