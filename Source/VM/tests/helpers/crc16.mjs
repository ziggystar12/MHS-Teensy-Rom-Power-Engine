// M3TP CRC-16/CCITT-FALSE, independently implemented for receiver fixtures.
export function crc16Ccitt(bytes){
 let crc=0xffff;
 for(const byte of bytes){crc^=byte<<8;for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;}
 return crc;
}
