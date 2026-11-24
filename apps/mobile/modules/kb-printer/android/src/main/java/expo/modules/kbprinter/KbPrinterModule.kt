package expo.modules.kbprinter

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID

/**
 * Sends raw bytes (ESC/POS, TSPL, ZPL) to a paired Bluetooth Classic printer over the serial port
 * profile. One connection is kept open and reused; it reconnects once if the printer dropped it.
 */
class KbPrinterModule : Module() {
  private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
  private var socket: BluetoothSocket? = null
  private var address: String? = null
  private val lock = Any()

  private fun adapter(): BluetoothAdapter? {
    val ctx = appContext.reactContext ?: return null
    val manager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    return manager?.adapter
  }

  override fun definition() = ModuleDefinition {
    Name("KbPrinter")

    Function("isAvailable") { adapter() != null }

    Function("isEnabled") { adapter()?.isEnabled == true }

    @SuppressLint("MissingPermission")
    AsyncFunction("bondedDevices") {
      val a = adapter() ?: throw CodedException("NO_BLUETOOTH", "This device has no Bluetooth.", null)
      if (!a.isEnabled) throw CodedException("BLUETOOTH_OFF", "Turn on Bluetooth first.", null)
      a.bondedDevices.map { d ->
        mapOf(
          "name" to (d.name ?: d.address),
          "address" to d.address,
          "major" to (d.bluetoothClass?.majorDeviceClass ?: 0)
        )
      }
    }

    AsyncFunction("write") { addr: String, base64: String ->
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      synchronized(lock) {
        try {
          send(connected(addr), bytes)
        } catch (e: Exception) {
          // the printer slept or was switched off and on: reconnect once
          close()
          send(connected(addr), bytes)
        }
      }
      true
    }

    AsyncFunction("disconnect") {
      synchronized(lock) { close() }
      true
    }

    OnDestroy {
      synchronized(lock) { close() }
    }
  }

  private fun connected(addr: String): BluetoothSocket {
    val s = socket
    if (s != null && s.isConnected && address == addr) return s
    close()
    val opened = open(addr)
    socket = opened
    address = addr
    return opened
  }

  /** Cheap printers have small buffers: send in chunks with a short pause. */
  private fun send(s: BluetoothSocket, bytes: ByteArray) {
    val out = s.outputStream
    var i = 0
    while (i < bytes.size) {
      val n = minOf(512, bytes.size - i)
      out.write(bytes, i, n)
      out.flush()
      i += n
      if (i < bytes.size) Thread.sleep(15)
    }
  }

  @SuppressLint("MissingPermission")
  private fun open(addr: String): BluetoothSocket {
    val a = adapter() ?: throw CodedException("NO_BLUETOOTH", "This device has no Bluetooth.", null)
    if (!a.isEnabled) throw CodedException("BLUETOOTH_OFF", "Turn on Bluetooth first.", null)
    val device = a.getRemoteDevice(addr)
    a.cancelDiscovery()
    return try {
      device.createRfcommSocketToServiceRecord(spp).also { it.connect() }
    } catch (e: Exception) {
      // many printers only accept an insecure serial socket
      try {
        device.createInsecureRfcommSocketToServiceRecord(spp).also { it.connect() }
      } catch (e2: Exception) {
        throw CodedException("CONNECT_FAILED", "Could not connect to the printer. Is it on, paired and in range?", e2)
      }
    }
  }

  private fun close() {
    try {
      socket?.close()
    } catch (_: Exception) {
    }
    socket = null
    address = null
  }
}
